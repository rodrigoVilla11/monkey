import { errors } from "@/server/api/errors";
import type { ScopedDb } from "@/server/db/scoped";
import { accountBalances } from "@/server/services/balances";
import { getRateProvider } from "@/server/services/rates";
import type { TransactionClient } from "@/server/services/audit/log";
import type { MoneyDTO } from "@/shared/contracts/common";
import type {
  CreateDebtPaymentRequest,
  CreateDebtRequest,
  DebtDetail,
  DebtDTO,
  DebtFilters,
  DebtPaymentDTO,
  NetPositionDTO,
  UpdateDebtRequest,
} from "@/shared/contracts/debts";
import {
  fromCalendarDate,
  toCalendarDate,
  todayIn,
  type CalendarDate,
} from "@/shared/dates";
import {
  debtBalance,
  debtForecast,
  debtPlanProgress,
  installmentProgress,
  monthlyInterestCost,
  netPosition,
  type DebtDirection,
  type DebtPlan,
} from "@/shared/debt";
// `money` acá construye el DTO de la respuesta; el de `shared/money` es el
// valor con el que calcula `convert`. Se renombra para que no se confundan.
import { convert, money as toMoney } from "@/shared/money";
import {
  describeRecurrence,
  type RecurrenceFrequency,
} from "@/shared/recurrence";

/**
 * Deudas y préstamos.
 *
 * ── Lo que este módulo NO hace ──────────────────────────────────────────────
 *
 * **No amortiza.** El saldo es `original − pagos`, sin capitalizar intereses.
 * Calcular la cuota de un préstamo daría un número que no coincide con el
 * recibo del banco —convenciones de días, comisiones, seguros, redondeos— y un
 * número casi correcto en finanzas es peor que ninguno.
 *
 * **No crea movimientos.** Un pago se vincula a uno que ya existe o se registra
 * suelto, igual que los aportes a metas. Si el pago generara un gasto, cargarlo
 * desde acá y desde la pantalla de movimientos lo contaría dos veces.
 *
 * ── Sobre el patrimonio ─────────────────────────────────────────────────────
 *
 * La posición neta (`netPositionOf`) vive en su propio endpoint y no toca la
 * curva de patrimonio de los reportes. Esa curva es una posición de CAJA;
 * meterle deudas redefiniría en silencio lo que significan todos los reportes
 * que ya existen.
 */

const DEBT_SELECT = {
  id: true,
  direction: true,
  counterparty: true,
  description: true,
  originalAmountMinor: true,
  currency: true,
  interestRateBps: true,
  startDate: true,
  dueDate: true,
  installmentsTotal: true,
  closedAt: true,
  createdAt: true,
  planAmountMinor: true,
  planFrequency: true,
  planInterval: true,
  planStartDate: true,
  account: { select: { id: true, name: true, currency: true } },
} as const;

interface DebtRow {
  id: string;
  direction: string;
  counterparty: string;
  description: string | null;
  originalAmountMinor: bigint;
  currency: string;
  interestRateBps: number | null;
  startDate: Date;
  dueDate: Date | null;
  installmentsTotal: number | null;
  closedAt: Date | null;
  createdAt: Date;
  planAmountMinor: bigint | null;
  planFrequency: string | null;
  planInterval: number | null;
  planStartDate: Date | null;
  account: { id: string; name: string; currency: string } | null;
}

/**
 * El plan de la fila, o `null`.
 *
 * Los cuatro campos van juntos por un CHECK en la base, pero acá se vuelve a
 * preguntar por los cuatro: el tipo de Prisma los da nullable por separado y
 * confiar en el CHECK desde TypeScript sería confiar en algo que el compilador
 * no ve.
 */
const planOf = (row: DebtRow): DebtPlan | null => {
  if (
    row.planAmountMinor === null ||
    row.planFrequency === null ||
    row.planInterval === null ||
    row.planStartDate === null
  ) {
    return null;
  }

  return {
    amountMinor: row.planAmountMinor,
    frequency: row.planFrequency as RecurrenceFrequency,
    interval: row.planInterval,
    startDate: toCalendarDate(row.planStartDate),
    installmentsTotal: row.installmentsTotal,
  };
};

interface Rollup {
  readonly paidMinor: bigint;
  readonly count: number;
  readonly firstDate: CalendarDate | null;
}

const EMPTY: Rollup = { paidMinor: 0n, count: 0, firstDate: null };

const money = (amountMinor: bigint, currency: string): MoneyDTO => ({
  amountMinor: amountMinor.toString(),
  currency,
});

const toDTO = (row: DebtRow, rollup: Rollup, today: CalendarDate): DebtDTO => {
  const balance = debtBalance(row.originalAmountMinor, rollup.paidMinor);
  const dueDate = row.dueDate === null ? null : toCalendarDate(row.dueDate);

  const plan = planOf(row);
  const progress =
    plan === null
      ? null
      : debtPlanProgress({
          plan,
          originalMinor: row.originalAmountMinor,
          paidMinor: balance.paidMinor,
          today,
        });

  const forecast = debtForecast({
    remainingMinor: balance.remainingMinor,
    paidMinor: balance.paidMinor,
    dueDate,
    firstPaymentDate: rollup.firstDate,
    today,
    plan: progress,
  });

  const interest = monthlyInterestCost(
    balance.remainingMinor,
    row.interestRateBps,
  );

  return {
    id: row.id,
    direction: row.direction as DebtDirection,
    counterparty: row.counterparty,
    description: row.description,
    original: money(row.originalAmountMinor, row.currency),
    paid: money(balance.paidMinor, row.currency),
    remaining: money(balance.remainingMinor, row.currency),
    overpaid: money(balance.overpaidMinor, row.currency),
    percentage: balance.percentage,
    settled: balance.settled,
    closedAt: row.closedAt?.toISOString() ?? null,
    interestRateBps: row.interestRateBps,
    monthlyInterestCost:
      interest === null ? null : money(interest, row.currency),
    startDate: toCalendarDate(row.startDate),
    dueDate,
    installments: installmentProgress(rollup.count, row.installmentsTotal),
    paymentCount: rollup.count,
    plan:
      plan === null || progress === null
        ? null
        : {
            amount: money(plan.amountMinor, row.currency),
            frequency: plan.frequency,
            interval: plan.interval,
            startDate: plan.startDate,
            // La frase la arma el módulo de recurrencia: la misma que describe
            // un movimiento programado, para que "cada 2 semanas" se diga
            // igual en las dos pantallas.
            description: describeRecurrence({
              frequency: plan.frequency,
              interval: plan.interval,
              startDate: plan.startDate,
            }),
            nextDate: progress.nextDate,
            expectedToDate: money(progress.expectedToDateMinor, row.currency),
            behind: money(progress.behindMinor, row.currency),
            dueCount: progress.dueCount,
            remainingInstallments: progress.remainingInstallments,
            payoffDate: progress.payoffDate,
            coversDebt: progress.coversDebt,
          },
    account: row.account,
    status: forecast.status,
    daysRemaining: forecast.daysRemaining,
    requiredPerMonth:
      forecast.requiredPerMonthMinor === null
        ? null
        : money(forecast.requiredPerMonthMinor, row.currency),
    actualPerMonth:
      forecast.actualPerMonthMinor === null
        ? null
        : money(forecast.actualPerMonthMinor, row.currency),
    projectedDate: forecast.projectedDate,
    createdAt: row.createdAt.toISOString(),
  };
};

/** Totales de pagos de varias deudas en UNA consulta, no una por deuda. */
const rollupsFor = async (
  db: ScopedDb,
  debtIds: readonly string[],
): Promise<Map<string, Rollup>> => {
  const result = new Map<string, Rollup>();
  if (debtIds.length === 0) return result;

  const grouped = await db.debtPayment.groupBy({
    by: ["debtId"],
    where: { debtId: { in: [...debtIds] } },
    _sum: { amountMinor: true },
    _count: { _all: true },
    _min: { date: true },
  });

  for (const row of grouped) {
    result.set(row.debtId, {
      paidMinor: row._sum.amountMinor ?? 0n,
      count: row._count._all,
      firstDate: row._min.date === null ? null : toCalendarDate(row._min.date),
    });
  }

  return result;
};

export const listDebts = async (
  db: ScopedDb,
  timezone: string,
  filters: DebtFilters,
): Promise<DebtDTO[]> => {
  const rows = await db.debt.findMany({
    where: {
      ...(filters.includeSettled === true ? {} : { closedAt: null }),
      ...(filters.direction !== undefined
        ? { direction: filters.direction }
        : {}),
    },
    // Por urgencia: lo que vence antes primero, lo sin plazo al final.
    orderBy: [
      { dueDate: { sort: "asc", nulls: "last" } },
      { createdAt: "asc" },
    ],
    select: DEBT_SELECT,
  });

  const rollups = await rollupsFor(
    db,
    rows.map((row) => row.id),
  );
  const today = todayIn(timezone);

  return rows.map((row) => toDTO(row, rollups.get(row.id) ?? EMPTY, today));
};

export const getDebt = async (
  db: ScopedDb,
  timezone: string,
  id: string,
): Promise<DebtDetail> => {
  const row = await db.debt.findFirst({ where: { id }, select: DEBT_SELECT });
  if (row === null) throw errors.notFound("No se encontró la deuda");

  const rollups = await rollupsFor(db, [id]);
  const dto = toDTO(row, rollups.get(id) ?? EMPTY, todayIn(timezone));

  const payments = await db.debtPayment.findMany({
    where: { debtId: id },
    orderBy: [{ date: "desc" }, { id: "desc" }],
    select: {
      id: true,
      amountMinor: true,
      date: true,
      installmentNo: true,
      createdAt: true,
      transaction: {
        select: {
          id: true,
          description: true,
          account: { select: { name: true } },
        },
      },
    },
  });

  return {
    ...dto,
    payments: payments.map((item): DebtPaymentDTO => ({
      id: item.id,
      amount: money(item.amountMinor, row.currency),
      date: toCalendarDate(item.date),
      installmentNo: item.installmentNo,
      transaction:
        item.transaction === null
          ? null
          : {
              id: item.transaction.id,
              description: item.transaction.description,
              accountName: item.transaction.account.name,
            },
      createdAt: item.createdAt.toISOString(),
    })),
  };
};

// ─────────────────────────────── escritura ───────────────────────────────────

interface SpaceContext {
  readonly spaceId: string;
  readonly primaryCurrency: string;
}

const validateAccount = async (
  db: ScopedDb,
  accountId: string | null | undefined,
): Promise<void> => {
  if (accountId == null) return;

  const account = await db.account.findFirst({
    where: { id: accountId },
    select: { isArchived: true },
  });

  if (account === null) throw errors.notFound("No se encontró la cuenta");
  if (account.isArchived) {
    throw errors.conflict("CONFLICT", "Esa cuenta está archivada");
  }
};

/**
 * Las cuatro columnas del plan, siempre las cuatro.
 *
 * Se escriben juntas —o las cuatro con valor, o las cuatro en `null`— porque
 * así lo exige el CHECK de la base. Escribirlas de a una desde el update
 * dejaría medio plan y la fila sería rechazada, que es exactamente lo que el
 * CHECK está para evitar.
 */
const planColumns = (
  plan: CreateDebtRequest["plan"] | null,
): {
  planAmountMinor: bigint | null;
  planFrequency: RecurrenceFrequency | null;
  planInterval: number | null;
  planStartDate: Date | null;
} =>
  plan == null
    ? {
        planAmountMinor: null,
        planFrequency: null,
        planInterval: null,
        planStartDate: null,
      }
    : {
        planAmountMinor: BigInt(plan.amountMinor),
        planFrequency: plan.frequency,
        planInterval: plan.interval,
        planStartDate: fromCalendarDate(plan.startDate),
      };

export const createDebt = async (
  db: ScopedDb,
  tx: TransactionClient,
  space: SpaceContext,
  input: CreateDebtRequest,
): Promise<string> => {
  await validateAccount(db, input.accountId);

  const created = await tx.debt.create({
    data: {
      spaceId: space.spaceId,
      accountId: input.accountId ?? null,
      direction: input.direction,
      counterparty: input.counterparty,
      description: input.description ?? null,
      originalAmountMinor: BigInt(input.originalAmountMinor),
      currency: input.currency ?? space.primaryCurrency,
      interestRateBps: input.interestRateBps ?? null,
      startDate: fromCalendarDate(input.startDate),
      dueDate: input.dueDate == null ? null : fromCalendarDate(input.dueDate),
      installmentsTotal: input.installmentsTotal ?? null,
      ...planColumns(input.plan ?? null),
    },
    select: { id: true },
  });

  return created.id;
};

export const updateDebt = async (
  db: ScopedDb,
  tx: TransactionClient,
  spaceId: string,
  id: string,
  input: UpdateDebtRequest,
): Promise<void> => {
  const existing = await db.debt.findFirst({
    where: { id },
    select: { startDate: true, dueDate: true },
  });
  if (existing === null) throw errors.notFound("No se encontró la deuda");

  await validateAccount(db, input.accountId);

  /**
   * El vencimiento no puede quedar antes del inicio combinando la edición con
   * lo que ya había. El esquema Zod solo ve lo que llega; acá se ve el
   * resultado.
   */
  const startDate = input.startDate ?? toCalendarDate(existing.startDate);
  const dueDate =
    input.dueDate !== undefined
      ? input.dueDate
      : existing.dueDate === null
        ? null
        : toCalendarDate(existing.dueDate);

  if (dueDate !== null && dueDate < startDate) {
    throw errors.conflict(
      "UNPROCESSABLE",
      "El vencimiento no puede ser anterior al inicio",
    );
  }

  await tx.debt.update({
    where: { id },
    data: {
      ...(input.counterparty !== undefined
        ? { counterparty: input.counterparty }
        : {}),
      ...(input.description !== undefined
        ? { description: input.description }
        : {}),
      ...(input.originalAmountMinor !== undefined
        ? { originalAmountMinor: BigInt(input.originalAmountMinor) }
        : {}),
      ...(input.interestRateBps !== undefined
        ? { interestRateBps: input.interestRateBps }
        : {}),
      ...(input.accountId !== undefined ? { accountId: input.accountId } : {}),
      ...(input.startDate !== undefined
        ? { startDate: fromCalendarDate(input.startDate) }
        : {}),
      ...(input.dueDate !== undefined
        ? { dueDate: dueDate === null ? null : fromCalendarDate(dueDate) }
        : {}),
      ...(input.installmentsTotal !== undefined
        ? { installmentsTotal: input.installmentsTotal }
        : {}),
      // `undefined` deja el plan como está; `null` lo saca. Las cuatro
      // columnas se mandan juntas o no se manda ninguna.
      ...(input.plan !== undefined ? planColumns(input.plan) : {}),
    },
  });

  // Subir el importe puede reabrir una deuda que estaba saldada.
  await refreshClosed(tx, spaceId, id);
};

export const deleteDebt = async (
  db: ScopedDb,
  tx: TransactionClient,
  id: string,
): Promise<void> => {
  const existing = await db.debt.findFirst({
    where: { id },
    select: { id: true },
  });
  if (existing === null) throw errors.notFound("No se encontró la deuda");

  /**
   * Borrado lógico. Los pagos se van con ella —no significan nada solos— pero
   * los MOVIMIENTOS vinculados no se tocan: son plata que salió de verdad.
   */
  await tx.debt.update({ where: { id }, data: { deletedAt: new Date() } });
};

// ──────────────────────────────── pagos ──────────────────────────────────────

export const addPayment = async (
  db: ScopedDb,
  tx: TransactionClient,
  space: SpaceContext,
  debtId: string,
  timezone: string,
  input: CreateDebtPaymentRequest,
): Promise<string> => {
  const debt = await db.debt.findFirst({
    where: { id: debtId },
    select: { id: true, currency: true, installmentsTotal: true },
  });
  if (debt === null) throw errors.notFound("No se encontró la deuda");

  if (
    input.installmentNo != null &&
    debt.installmentsTotal !== null &&
    input.installmentNo > debt.installmentsTotal
  ) {
    throw errors.conflict(
      "UNPROCESSABLE",
      `La deuda se pactó en ${String(debt.installmentsTotal)} cuotas`,
    );
  }

  /**
   * Los índices únicos de la base son la garantía; estos chequeos existen para
   * dar un mensaje que se entienda. Sin ellos el usuario vería "eso ya existe"
   * sin saber qué, y sin los índices dos peticiones simultáneas sí lograrían
   * contar el mismo pago dos veces.
   */
  if (input.transactionId !== undefined) {
    const already = await db.debtPayment.findFirst({
      where: { transactionId: input.transactionId },
      select: { debtId: true },
    });

    if (already !== null) {
      throw errors.conflict(
        "CONFLICT",
        already.debtId === debtId
          ? "Ese movimiento ya está contado en esta deuda"
          : "Ese movimiento ya está contado en otra deuda",
      );
    }
  }

  if (input.installmentNo != null) {
    const already = await db.debtPayment.findFirst({
      where: { debtId, installmentNo: input.installmentNo },
      select: { id: true },
    });

    if (already !== null) {
      throw errors.conflict(
        "CONFLICT",
        `La cuota ${String(input.installmentNo)} ya está registrada`,
      );
    }
  }

  const resolved = await resolveAmount(db, space, debt.currency, input);

  const created = await tx.debtPayment.create({
    data: {
      spaceId: space.spaceId,
      debtId,
      transactionId: input.transactionId ?? null,
      amountMinor: resolved.amountMinor,
      date: fromCalendarDate(resolved.date ?? input.date ?? todayIn(timezone)),
      installmentNo: input.installmentNo ?? null,
    },
    select: { id: true },
  });

  await refreshClosed(tx, space.spaceId, debtId);

  return created.id;
};

/**
 * Importe y fecha del pago.
 *
 * Vinculado a un movimiento, los dos salen de él: escribirlos a mano permitiría
 * que el pago diga 200 y la transferencia 180.
 */
const resolveAmount = async (
  db: ScopedDb,
  space: SpaceContext,
  debtCurrency: string,
  input: CreateDebtPaymentRequest,
): Promise<{ amountMinor: bigint; date: CalendarDate | null }> => {
  if (input.transactionId === undefined) {
    // El schema garantiza que si no hay movimiento hay importe.
    return { amountMinor: BigInt(input.amountMinor ?? "0"), date: null };
  }

  const transaction = await db.transaction.findFirst({
    where: { id: input.transactionId },
    select: {
      amountMinor: true,
      amountPrimaryMinor: true,
      currency: true,
      date: true,
    },
  });

  if (transaction === null) {
    throw errors.notFound("No se encontró el movimiento");
  }

  if (transaction.currency === debtCurrency) {
    return {
      amountMinor: transaction.amountMinor,
      date: toCalendarDate(transaction.date),
    };
  }

  /**
   * Monedas distintas: solo se resuelve si la deuda está en la primaria, porque
   * ahí el movimiento ya trae su importe convertido Y congelado. Inventar una
   * conversión nueva metería un número aproximado en un saldo de deuda.
   */
  if (
    debtCurrency === space.primaryCurrency &&
    transaction.amountPrimaryMinor !== null
  ) {
    return {
      amountMinor: transaction.amountPrimaryMinor,
      date: toCalendarDate(transaction.date),
    };
  }

  throw errors.conflict(
    "UNPROCESSABLE",
    `El movimiento está en ${transaction.currency} y la deuda en ${debtCurrency}: cargá el pago con el importe que corresponda`,
  );
};

export const removePayment = async (
  db: ScopedDb,
  tx: TransactionClient,
  spaceId: string,
  debtId: string,
  paymentId: string,
): Promise<void> => {
  const existing = await db.debtPayment.findFirst({
    where: { id: paymentId, debtId },
    select: { id: true },
  });
  if (existing === null) throw errors.notFound("No se encontró el pago");

  // Borrado real: un pago no es un hecho económico, es una anotación sobre uno.
  // El movimiento vinculado, si lo hay, queda intacto.
  await tx.debtPayment.delete({ where: { id: paymentId } });

  await refreshClosed(tx, spaceId, debtId);
};

/**
 * Recalcula `closedAt` después de cualquier cambio.
 *
 * Se cierra al cubrir el importe y se REABRE si el total vuelve a quedar corto
 * —porque se borró un pago o se subió el importe pactado—. Una deuda marcada
 * como saldada con saldo pendiente es una contradicción en pantalla.
 *
 * **Lee por `tx` y no por el cliente scopeado.** El pago recién escrito todavía
 * no está confirmado: leyéndolo desde afuera de la transacción se ve el estado
 * ANTERIOR y la deuda nunca se cerraría ni se reabriría. Como `tx` no está
 * scopeado, el `spaceId` va explícito.
 */
const refreshClosed = async (
  tx: TransactionClient,
  spaceId: string,
  debtId: string,
): Promise<void> => {
  const debt = await tx.debt.findFirst({
    where: { id: debtId, spaceId, deletedAt: null },
    select: { originalAmountMinor: true, closedAt: true },
  });
  if (debt === null) return;

  const total = await tx.debtPayment.aggregate({
    where: { debtId, spaceId },
    _sum: { amountMinor: true },
  });

  const settled = (total._sum.amountMinor ?? 0n) >= debt.originalAmountMinor;

  if (settled && debt.closedAt === null) {
    await tx.debt.update({
      where: { id: debtId },
      data: { closedAt: new Date() },
    });
  } else if (!settled && debt.closedAt !== null) {
    await tx.debt.update({ where: { id: debtId }, data: { closedAt: null } });
  }
};

// ───────────────────────────── posición neta ─────────────────────────────────

/** Lo que aporta una moneda a la posición, antes de convertir. */
interface Bucket {
  accountsMinor: bigint;
  receivableMinor: bigint;
  payableMinor: bigint;
  /** Cuántas cuentas y deudas hay acá. Para poder decir cuántas quedan afuera. */
  positions: number;
}

const emptyBucket = (): Bucket => ({
  accountsMinor: 0n,
  receivableMinor: 0n,
  payableMinor: 0n,
  positions: 0,
});

/**
 * Caja + lo que te deben − lo que debés.
 *
 * ── Sobre las monedas ───────────────────────────────────────────────────────
 *
 * Lo que está en otra moneda se convierte con la ÚLTIMA cotización cargada, la
 * misma que usa el patrimonio del inicio. Es una estimación de hoy, no un dato
 * histórico congelado como el de una transacción: por eso se devuelve junto con
 * la fecha de cada cotización usada, y la pantalla la muestra. Convertir sin
 * decir con qué y de cuándo sería presentar una estimación como si fuera un
 * hecho.
 *
 * Lo que NO se puede convertir —no hay cotización cargada para esa moneda—
 * queda afuera del total y se dice cuál falta y cuántas posiciones dejó afuera.
 * Inventar una cotización para no mostrar un hueco sería mucho peor que el
 * hueco.
 *
 * Cada cifra se convierte por separado y no solo el neto: si no, "en cuentas" y
 * "por cobrar" no sumarían el total que tienen debajo.
 */
export const netPositionOf = async (
  db: ScopedDb,
  space: SpaceContext,
  timezone: string,
): Promise<NetPositionDTO> => {
  const today = todayIn(timezone);

  const [balances, debts] = await Promise.all([
    accountBalances(db),
    db.debt.findMany({
      where: { closedAt: null },
      select: {
        id: true,
        direction: true,
        currency: true,
        originalAmountMinor: true,
      },
    }),
  ]);

  const buckets = new Map<string, Bucket>();
  const bucketOf = (currency: string): Bucket => {
    const existing = buckets.get(currency);
    if (existing !== undefined) return existing;

    const created = emptyBucket();
    buckets.set(currency, created);
    return created;
  };

  for (const balance of balances.values()) {
    const bucket = bucketOf(balance.currency);
    bucket.accountsMinor += balance.balanceMinor;
    bucket.positions += 1;
  }

  const rollups = await rollupsFor(
    db,
    debts.map((debt) => debt.id),
  );

  for (const debt of debts) {
    const { remainingMinor } = debtBalance(
      debt.originalAmountMinor,
      rollups.get(debt.id)?.paidMinor ?? 0n,
    );

    const bucket = bucketOf(debt.currency);
    bucket.positions += 1;
    if (debt.direction === "OWED_TO_ME")
      bucket.receivableMinor += remainingMinor;
    else bucket.payableMinor += remainingMinor;
  }

  const provider = getRateProvider();

  let accountsMinor = 0n;
  let receivableMinor = 0n;
  let payableMinor = 0n;
  let excludedCount = 0;
  const missingRates: string[] = [];
  const conversions: { currency: string; rate: string; date: string }[] = [];

  for (const [currency, bucket] of buckets) {
    if (currency === space.primaryCurrency) {
      accountsMinor += bucket.accountsMinor;
      receivableMinor += bucket.receivableMinor;
      payableMinor += bucket.payableMinor;
      continue;
    }

    const lookup = await provider.find(currency, space.primaryCurrency, today);
    const converted =
      lookup === null
        ? null
        : convertBucket(bucket, currency, lookup.rate, space.primaryCurrency);

    if (lookup === null || converted === null) {
      missingRates.push(currency);
      excludedCount += bucket.positions;
      continue;
    }

    accountsMinor += converted.accountsMinor;
    receivableMinor += converted.receivableMinor;
    payableMinor += converted.payableMinor;
    conversions.push({ currency, rate: lookup.rate, date: lookup.date });
  }

  const position = netPosition(accountsMinor, receivableMinor, payableMinor);

  return {
    accounts: money(position.accountsMinor, space.primaryCurrency),
    receivable: money(position.receivableMinor, space.primaryCurrency),
    payable: money(position.payableMinor, space.primaryCurrency),
    net: money(position.netMinor, space.primaryCurrency),
    excludedCount,
    // Ordenadas para que dos llamadas seguidas digan lo mismo en el mismo orden.
    missingRates: missingRates.sort((a, b) => a.localeCompare(b)),
    conversions: conversions.sort((a, b) =>
      a.currency.localeCompare(b.currency),
    ),
  };
};

/**
 * Las tres cifras de una moneda, convertidas.
 *
 * `null` si la cotización no sirve —mal formada, moneda inválida—, que se trata
 * igual que si faltara: no se convierte a medias.
 */
const convertBucket = (
  bucket: Bucket,
  currency: string,
  rate: string,
  primaryCurrency: string,
): Bucket | null => {
  const one = (amountMinor: bigint): bigint | null => {
    const result = convert(
      toMoney(amountMinor, currency),
      rate,
      primaryCurrency,
    );
    return result.ok ? result.value.amountMinor : null;
  };

  const accountsMinor = one(bucket.accountsMinor);
  const receivableMinor = one(bucket.receivableMinor);
  const payableMinor = one(bucket.payableMinor);

  if (
    accountsMinor === null ||
    receivableMinor === null ||
    payableMinor === null
  ) {
    return null;
  }

  return {
    accountsMinor,
    receivableMinor,
    payableMinor,
    positions: bucket.positions,
  };
};
