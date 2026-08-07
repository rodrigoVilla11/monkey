import { randomUUID } from "node:crypto";

import { errors } from "@/server/api/errors";
import type { ScopedDb } from "@/server/db/scoped";
import type { TransactionClient } from "@/server/services/audit/log";
import { getRateProvider } from "@/server/services/rates";
import type {
  CreateTransferRequest,
  TransferDTO,
  UpdateTransferRequest,
} from "@/shared/contracts/transfers";
import {
  fromCalendarDate,
  toCalendarDate,
  todayIn,
  type CalendarDate,
} from "@/shared/dates";
import { convert, deriveRate, money } from "@/shared/money";

/**
 * Transferencias entre cuentas.
 *
 * Una transferencia son dos transacciones TRANSFER con el mismo
 * `transferGroupId` y sentidos opuestos. Se crean, editan y borran siempre
 * juntas y dentro de una transacción de base: media transferencia es un saldo
 * mal, y un saldo mal no se nota hasta que alguien cuadra a mano.
 *
 * ── La invariante que sostiene todo el archivo ────────────────────────────────
 *
 * **Una transferencia no cambia el patrimonio del Space.** Sale de una cuenta
 * y entra en otra: el neto en la moneda primaria tiene que ser exactamente
 * cero. La curva de patrimonio de los reportes suma las dos patas con signo,
 * así que si las dos no valen lo mismo en moneda primaria, el patrimonio salta
 * solo y nadie sabe por qué.
 *
 * Se garantiza por construcción y no por control posterior: se calcula UN
 * importe en moneda primaria y se le asigna a las dos patas.
 *
 * Cuál es ese importe depende de dónde esté la moneda primaria:
 *
 *  · Si la cuenta de origen está en la primaria → es lo que salió.
 *  · Si la de destino está en la primaria       → es lo que entró.
 *  · Si ninguna lo está                          → se convierte lo que salió
 *    con una cotización (explícita o de la tabla).
 *
 * Una pata en la moneda primaria NO puede llevar cotización congelada —lo
 * prohíbe el CHECK `Transaction_fx_snapshot_complete`—, así que cuando existe
 * es ella la que manda. La otra pata recibe ese mismo importe y su cotización
 * sale de la propia operación con `deriveRate`.
 */

const LEG_SELECT = {
  id: true,
  transferGroupId: true,
  transferDirection: true,
  amountMinor: true,
  currency: true,
  exchangeRateSnapshot: true,
  amountPrimaryMinor: true,
  date: true,
  description: true,
  notes: true,
  createdAt: true,
  createdByUserId: true,
  createdByName: true,
  account: {
    select: { id: true, name: true, color: true, icon: true, currency: true },
  },
  createdBy: { select: { avatarUrl: true } },
} as const;

interface LegRow {
  id: string;
  transferGroupId: string | null;
  transferDirection: "OUT" | "IN" | null;
  amountMinor: bigint;
  currency: string;
  exchangeRateSnapshot: { toString(): string } | null;
  amountPrimaryMinor: bigint | null;
  date: Date;
  description: string | null;
  notes: string | null;
  createdAt: Date;
  createdByUserId: string | null;
  createdByName: string;
  account: {
    id: string;
    name: string;
    color: string | null;
    icon: string | null;
    currency: string;
  };
  createdBy: { avatarUrl: string | null } | null;
}

interface SpaceContext {
  readonly spaceId: string;
  readonly primaryCurrency: string;
}

interface Actor {
  readonly userId: string;
  readonly name: string;
  readonly timezone: string;
}

/** Lo que se guarda en una pata además del importe. */
interface LegConversion {
  readonly exchangeRateSnapshot: string | null;
  readonly amountPrimaryMinor: bigint | null;
}

interface ResolvedTransfer {
  readonly amountOutMinor: bigint;
  readonly amountInMinor: bigint;
  readonly outCurrency: string;
  readonly inCurrency: string;
  readonly amountPrimaryMinor: bigint;
  readonly out: LegConversion;
  readonly in: LegConversion;
}

/**
 * Verifica que las cuentas sean del Space, distintas y utilizables.
 *
 * Va por el cliente scopeado: una cuenta de otro Space no aparece y se
 * responde 404, sin confirmar que exista en otro lado.
 */
const loadAccounts = async (
  db: ScopedDb,
  fromAccountId: string,
  toAccountId: string,
): Promise<{ from: AccountRef; to: AccountRef }> => {
  if (fromAccountId === toAccountId) {
    throw errors.conflict(
      "CONFLICT",
      "El origen y el destino tienen que ser cuentas distintas",
    );
  }

  const accounts = await db.account.findMany({
    where: { id: { in: [fromAccountId, toAccountId] } },
    select: { id: true, currency: true, isArchived: true, name: true },
  });

  const from = accounts.find((a) => a.id === fromAccountId);
  const to = accounts.find((a) => a.id === toAccountId);

  if (from === undefined)
    throw errors.notFound("No se encontró la cuenta de origen");
  if (to === undefined)
    throw errors.notFound("No se encontró la cuenta de destino");

  for (const account of [from, to]) {
    if (account.isArchived) {
      throw errors.conflict(
        "CONFLICT",
        `La cuenta "${account.name}" está archivada`,
      );
    }
  }

  return { from, to };
};

interface AccountRef {
  id: string;
  currency: string;
  isArchived: boolean;
  name: string;
}

/**
 * Resuelve importes y conversión de las dos patas.
 *
 * Es donde vive la invariante descrita arriba. Devuelve las dos patas ya
 * listas para escribir: quien llama no vuelve a decidir nada de dinero.
 */
const resolveTransfer = async (
  from: AccountRef,
  to: AccountRef,
  primaryCurrency: string,
  amountOutMinor: bigint,
  rawAmountInMinor: bigint | undefined,
  date: CalendarDate,
  explicitRate: string | undefined,
): Promise<ResolvedTransfer> => {
  const sameCurrency = from.currency === to.currency;

  /**
   * Con la misma moneda a los dos lados no hay dos importes: lo que sale es lo
   * que entra. Aceptar un importe de destino distinto sería inventar plata.
   */
  if (sameCurrency) {
    if (rawAmountInMinor !== undefined && rawAmountInMinor !== amountOutMinor) {
      throw errors.conflict(
        "UNPROCESSABLE",
        "Entre cuentas de la misma moneda tiene que entrar lo mismo que sale",
      );
    }
  } else if (rawAmountInMinor === undefined) {
    throw errors.conflict(
      "UNPROCESSABLE",
      `Las cuentas están en monedas distintas (${from.currency} y ${to.currency}): indicá cuánto entra en la cuenta de destino`,
    );
  }

  const amountInMinor = sameCurrency
    ? amountOutMinor
    : (rawAmountInMinor ?? amountOutMinor);

  // El importe en moneda primaria: uno solo para las dos patas.
  let amountPrimaryMinor: bigint;

  if (from.currency === primaryCurrency) {
    amountPrimaryMinor = amountOutMinor;
  } else if (to.currency === primaryCurrency) {
    amountPrimaryMinor = amountInMinor;
  } else {
    amountPrimaryMinor = await convertToPrimary(
      amountOutMinor,
      from.currency,
      primaryCurrency,
      date,
      explicitRate,
    );
  }

  if (amountPrimaryMinor <= 0n) {
    throw errors.conflict(
      "UNPROCESSABLE",
      "El importe es demasiado chico para convertirlo a la moneda del espacio",
    );
  }

  return {
    amountOutMinor,
    amountInMinor,
    outCurrency: from.currency,
    inCurrency: to.currency,
    amountPrimaryMinor,
    out: legConversion(
      amountOutMinor,
      from.currency,
      amountPrimaryMinor,
      primaryCurrency,
    ),
    in: legConversion(
      amountInMinor,
      to.currency,
      amountPrimaryMinor,
      primaryCurrency,
    ),
  };
};

/**
 * Conversión congelada de una pata.
 *
 * En la moneda primaria los dos campos van en null: no hay nada que convertir
 * y el CHECK exige que vayan juntos o ninguno. En otra moneda, el importe en
 * primaria ya está decidido y la cotización se DEDUCE de él — no se busca una
 * de mercado, porque entonces las dos patas dejarían de valer lo mismo.
 */
const legConversion = (
  amountMinor: bigint,
  currency: string,
  amountPrimaryMinor: bigint,
  primaryCurrency: string,
): LegConversion => {
  if (currency === primaryCurrency) {
    return { exchangeRateSnapshot: null, amountPrimaryMinor: null };
  }

  const rate = deriveRate(
    money(amountMinor, currency),
    money(amountPrimaryMinor, primaryCurrency),
  );

  if (!rate.ok) {
    throw errors.conflict(
      "UNPROCESSABLE",
      "No se pudo calcular la cotización de la transferencia",
    );
  }

  return { exchangeRateSnapshot: rate.value, amountPrimaryMinor };
};

/** Solo se usa cuando NINGUNA de las dos cuentas está en la moneda primaria. */
const convertToPrimary = async (
  amountMinor: bigint,
  currency: string,
  primaryCurrency: string,
  date: CalendarDate,
  explicitRate: string | undefined,
): Promise<bigint> => {
  let rate = explicitRate;

  if (rate === undefined) {
    const found = await getRateProvider().find(currency, primaryCurrency, date);
    if (found === null) {
      throw errors.conflict(
        "UNPROCESSABLE",
        `Ninguna de las dos cuentas está en ${primaryCurrency} y no hay cotización de ${currency}. Cargá una o indicá el tipo de cambio`,
      );
    }
    rate = found.rate;
  }

  const converted = convert(
    money(amountMinor, currency),
    rate,
    primaryCurrency,
  );
  if (!converted.ok) {
    throw errors.conflict("UNPROCESSABLE", "El tipo de cambio no es válido");
  }

  return converted.value.amountMinor;
};

// ─────────────────────────────── lectura ─────────────────────────────────────

const toDTO = (
  out: LegRow,
  incoming: LegRow,
  primaryCurrency: string,
): TransferDTO => {
  /**
   * El importe en primaria sale de la pata que lo tenga convertido; si ninguna
   * lo tiene es porque está en la moneda primaria, y ahí el importe es el
   * propio. Las dos rutas dan el mismo número: eso es la invariante.
   */
  const amountPrimaryMinor =
    out.amountPrimaryMinor ?? incoming.amountPrimaryMinor ?? out.amountMinor;

  /**
   * Cotización real de la operación, de origen a destino. Se recalcula al leer
   * en vez de guardarse: lo que hay en la base son las dos cotizaciones contra
   * la moneda primaria, y esta es la que le sirve a quien mira.
   */
  const derived =
    out.currency === incoming.currency
      ? null
      : deriveRate(
          money(out.amountMinor, out.currency),
          money(incoming.amountMinor, incoming.currency),
        );

  const rate = derived?.ok === true ? derived.value : null;

  return {
    id: out.transferGroupId ?? "",
    from: out.account,
    to: incoming.account,
    amountOut: {
      amountMinor: out.amountMinor.toString(),
      currency: out.currency,
    },
    amountIn: {
      amountMinor: incoming.amountMinor.toString(),
      currency: incoming.currency,
    },
    amountPrimary: {
      amountMinor: amountPrimaryMinor.toString(),
      currency: primaryCurrency,
    },
    rate,
    date: toCalendarDate(out.date),
    description: out.description,
    notes: out.notes,
    author: {
      userId: out.createdByUserId,
      name: out.createdByName,
      avatarUrl: out.createdBy?.avatarUrl ?? null,
    },
    legIds: [out.id, incoming.id],
    createdAt: out.createdAt.toISOString(),
  };
};

/** Ordena el par por sentido. Falla si el grupo no tiene exactamente dos patas. */
const splitLegs = (legs: readonly LegRow[]): { out: LegRow; in: LegRow } => {
  const out = legs.find((leg) => leg.transferDirection === "OUT");
  const incoming = legs.find((leg) => leg.transferDirection === "IN");

  // El unique parcial de la base impide más de una pata por sentido; esto
  // cubre el caso de que falte una, que solo puede venir de datos corruptos.
  if (out === undefined || incoming === undefined) {
    throw errors.notFound("No se encontró la transferencia");
  }

  return { out, in: incoming };
};

const loadLegs = async (
  db: ScopedDb,
  transferGroupId: string,
): Promise<{ out: LegRow; in: LegRow }> => {
  const legs = await db.transaction.findMany({
    where: { transferGroupId },
    select: LEG_SELECT,
  });

  if (legs.length === 0) {
    throw errors.notFound("No se encontró la transferencia");
  }

  return splitLegs(legs);
};

export const getTransfer = async (
  db: ScopedDb,
  primaryCurrency: string,
  transferGroupId: string,
): Promise<TransferDTO> => {
  const { out, in: incoming } = await loadLegs(db, transferGroupId);
  return toDTO(out, incoming, primaryCurrency);
};

// ─────────────────────────────── escritura ───────────────────────────────────

export const createTransfer = async (
  db: ScopedDb,
  tx: TransactionClient,
  space: SpaceContext,
  actor: Actor,
  input: CreateTransferRequest,
): Promise<string> => {
  const { from, to } = await loadAccounts(
    db,
    input.fromAccountId,
    input.toAccountId,
  );

  // "Hoy" en la timezone de quien carga, no la del servidor.
  const date = input.date ?? todayIn(actor.timezone);

  const resolved = await resolveTransfer(
    from,
    to,
    space.primaryCurrency,
    BigInt(input.amountOutMinor),
    input.amountInMinor === undefined ? undefined : BigInt(input.amountInMinor),
    date,
    input.exchangeRate,
  );

  /**
   * El grupo se genera acá y no en la base: las dos patas tienen que nacer con
   * el mismo valor y un default por fila daría uno distinto a cada una.
   */
  const transferGroupId = randomUUID();

  const common = {
    spaceId: space.spaceId,
    createdByUserId: actor.userId,
    createdByName: actor.name,
    type: "TRANSFER" as const,
    status: "CLEARED" as const,
    // Sin categoría: un CHECK lo exige. Mover plata entre cuentas propias no
    // es un gasto y no puede aparecer en el desglose por categoría.
    categoryId: null,
    date: fromCalendarDate(date),
    description: input.description ?? null,
    notes: input.notes ?? null,
    transferGroupId,
  };

  await tx.transaction.createMany({
    data: [
      {
        ...common,
        accountId: from.id,
        transferDirection: "OUT" as const,
        amountMinor: resolved.amountOutMinor,
        currency: resolved.outCurrency,
        exchangeRateSnapshot: resolved.out.exchangeRateSnapshot,
        amountPrimaryMinor: resolved.out.amountPrimaryMinor,
      },
      {
        ...common,
        accountId: to.id,
        transferDirection: "IN" as const,
        amountMinor: resolved.amountInMinor,
        currency: resolved.inCurrency,
        exchangeRateSnapshot: resolved.in.exchangeRateSnapshot,
        amountPrimaryMinor: resolved.in.amountPrimaryMinor,
      },
    ],
  });

  return transferGroupId;
};

/**
 * Edición: se recalcula la transferencia entera y se reescriben las dos patas.
 *
 * No hay edición parcial de una pata. Cambiar el importe de un lado sin el
 * otro, o una cuenta sin revisar la conversión, deja el par descuadrado — que
 * es exactamente el bug que este módulo existe para evitar.
 *
 * Los IDs de las filas y el grupo se conservan: lo que apunte a una pata
 * (adjuntos, más adelante) no se rompe.
 */
export const updateTransfer = async (
  db: ScopedDb,
  tx: TransactionClient,
  space: SpaceContext,
  transferGroupId: string,
  input: UpdateTransferRequest,
): Promise<void> => {
  const current = await loadLegs(db, transferGroupId);

  const { from, to } = await loadAccounts(
    db,
    input.fromAccountId ?? current.out.account.id,
    input.toAccountId ?? current.in.account.id,
  );

  const date = input.date ?? toCalendarDate(current.out.date);
  const amountOutMinor =
    input.amountOutMinor !== undefined
      ? BigInt(input.amountOutMinor)
      : current.out.amountMinor;

  /**
   * El importe de destino solo se arrastra si hace falta pedirlo, es decir
   * entre monedas distintas. Con la misma moneda a los dos lados lo deriva
   * `resolveTransfer`: reusar el anterior haría que corregir SOLO el importe de
   * salida chocara contra el propio importe viejo de entrada.
   *
   * Y se arrastra únicamente si la moneda de destino no cambió: un importe en
   * pesos no significa nada si la cuenta ahora está en euros.
   */
  const crossCurrency = from.currency !== to.currency;
  const keepsInCurrency = to.currency === current.in.currency;
  const amountInMinor =
    input.amountInMinor !== undefined
      ? BigInt(input.amountInMinor)
      : crossCurrency && keepsInCurrency
        ? current.in.amountMinor
        : undefined;

  const resolved = await resolveTransfer(
    from,
    to,
    space.primaryCurrency,
    amountOutMinor,
    amountInMinor,
    date,
    input.exchangeRate,
  );

  const common = {
    date: fromCalendarDate(date),
    ...(input.description !== undefined
      ? { description: input.description }
      : {}),
    ...(input.notes !== undefined ? { notes: input.notes } : {}),
  };

  await tx.transaction.update({
    where: { id: current.out.id },
    data: {
      ...common,
      accountId: from.id,
      amountMinor: resolved.amountOutMinor,
      currency: resolved.outCurrency,
      exchangeRateSnapshot: resolved.out.exchangeRateSnapshot,
      amountPrimaryMinor: resolved.out.amountPrimaryMinor,
    },
  });

  await tx.transaction.update({
    where: { id: current.in.id },
    data: {
      ...common,
      accountId: to.id,
      amountMinor: resolved.amountInMinor,
      currency: resolved.inCurrency,
      exchangeRateSnapshot: resolved.in.exchangeRateSnapshot,
      amountPrimaryMinor: resolved.in.amountPrimaryMinor,
    },
  });
};

/** Borra las dos patas. Borrar una sola descuadraría los dos saldos. */
export const deleteTransfer = async (
  db: ScopedDb,
  tx: TransactionClient,
  transferGroupId: string,
): Promise<void> => {
  const { out, in: incoming } = await loadLegs(db, transferGroupId);

  await tx.transaction.updateMany({
    where: { id: { in: [out.id, incoming.id] } },
    data: { deletedAt: new Date() },
  });
};

// ──────────────────────────────── listado ────────────────────────────────────

/**
 * Contraparte de cada pata, para que el listado de movimientos pueda decir
 * "Efectivo → Banco" sin una consulta por fila.
 *
 * Una sola consulta para toda la página: se traen todas las patas de los
 * grupos presentes y se indexa por el ID de la transacción de enfrente.
 */
export const counterpartAccounts = async (
  db: ScopedDb,
  transferGroupIds: readonly string[],
): Promise<Map<string, { id: string; name: string }>> => {
  const result = new Map<string, { id: string; name: string }>();
  if (transferGroupIds.length === 0) return result;

  const legs = await db.transaction.findMany({
    where: { transferGroupId: { in: [...new Set(transferGroupIds)] } },
    select: {
      id: true,
      transferGroupId: true,
      account: { select: { id: true, name: true } },
    },
  });

  const byGroup = new Map<string, typeof legs>();
  for (const leg of legs) {
    if (leg.transferGroupId === null) continue;
    const bucket = byGroup.get(leg.transferGroupId) ?? [];
    bucket.push(leg);
    byGroup.set(leg.transferGroupId, bucket);
  }

  for (const bucket of byGroup.values()) {
    for (const leg of bucket) {
      const other = bucket.find((candidate) => candidate.id !== leg.id);
      if (other !== undefined) result.set(leg.id, other.account);
    }
  }

  return result;
};
