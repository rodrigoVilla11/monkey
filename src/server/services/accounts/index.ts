import { errors } from "@/server/api/errors";
import type { ScopedDb } from "@/server/db/scoped";
import {
  writeAuditLog,
  type TransactionClient,
} from "@/server/services/audit/log";
import { accountBalances } from "@/server/services/balances";
import { getRateProvider } from "@/server/services/rates";
import type {
  AccountDTO,
  AccountWithBalance,
  CreateAccountRequest,
  UpdateAccountRequest,
} from "@/shared/contracts/accounts";
import type { MoneyDTO } from "@/shared/contracts/common";
import { todayIn, type CalendarDate } from "@/shared/dates";
import { convert, money } from "@/shared/money";

/**
 * Cuentas y billeteras.
 *
 * Todas las consultas usan el cliente scopeado que entrega `route()`: el
 * `spaceId` ya está verificado contra Membership y se inyecta solo. Acá no
 * aparece ni una vez en un `where`, y eso es exactamente lo que se busca.
 */

const toDTO = (row: {
  id: string;
  name: string;
  type: string;
  currency: string;
  initialBalanceMinor: bigint;
  color: string | null;
  icon: string | null;
  sortOrder: number;
  isArchived: boolean;
  includeInNetWorth: boolean;
  creditClosingDay: number | null;
  creditDueDay: number | null;
  createdAt: Date;
}): AccountDTO => ({
  id: row.id,
  name: row.name,
  type: row.type as AccountDTO["type"],
  currency: row.currency,
  initialBalanceMinor: row.initialBalanceMinor.toString(),
  color: row.color,
  icon: row.icon,
  sortOrder: row.sortOrder,
  isArchived: row.isArchived,
  includeInNetWorth: row.includeInNetWorth,
  creditClosingDay: row.creditClosingDay,
  creditDueDay: row.creditDueDay,
  createdAt: row.createdAt.toISOString(),
});

const SELECT = {
  id: true,
  name: true,
  type: true,
  currency: true,
  initialBalanceMinor: true,
  color: true,
  icon: true,
  sortOrder: true,
  isArchived: true,
  includeInNetWorth: true,
  creditClosingDay: true,
  creditDueDay: true,
  createdAt: true,
} as const;

export const listAccounts = async (
  db: ScopedDb,
  options: {
    readonly includeArchived?: boolean;
    /** Sin esto no se convierte nada y `balancePrimary` viene en null. */
    readonly primaryCurrency?: string;
    readonly today?: CalendarDate;
  } = {},
): Promise<AccountWithBalance[]> => {
  const rows = await db.account.findMany({
    where: options.includeArchived === true ? {} : { isArchived: false },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: SELECT,
  });

  // Una sola consulta agregada para todos los saldos, no una por cuenta.
  const balances = await accountBalances(db, {
    includeArchived: options.includeArchived ?? false,
  });

  /**
   * Las cotizaciones se buscan UNA vez por moneda, no una por cuenta: cinco
   * cuentas en dólares son cinco filas en pantalla y una sola consulta.
   */
  const rates = await ratesFor(
    new Set(rows.map((row) => row.currency)),
    options.primaryCurrency,
    options.today,
  );

  return rows.map((row) => {
    const balance = balances.get(row.id);
    const amountMinor = balance?.balanceMinor ?? row.initialBalanceMinor;

    return {
      ...toDTO(row),
      balance: { amountMinor: amountMinor.toString(), currency: row.currency },
      balancePrimary: convertBalance(
        amountMinor,
        row.currency,
        options.primaryCurrency,
        rates,
      ),
      transactionCount: balance?.transactionCount ?? 0,
    };
  });
};

/**
 * Cotizaciones de cada moneda hacia la primaria, en un solo viaje por moneda.
 *
 * Devuelve un mapa vacío si no se pidió conversión. Las monedas sin cotización
 * simplemente no entran: quien llama las trata como "no convertible" y la
 * pantalla lo dice, en vez de inventar un número.
 */
const ratesFor = async (
  currencies: ReadonlySet<string>,
  primaryCurrency: string | undefined,
  today: CalendarDate | undefined,
): Promise<Map<string, string>> => {
  const result = new Map<string, string>();
  if (primaryCurrency === undefined) return result;

  const onDate = today ?? todayIn("UTC");
  const provider = getRateProvider();

  for (const currency of currencies) {
    if (currency === primaryCurrency) continue;
    const found = await provider.find(currency, primaryCurrency, onDate);
    if (found !== null) result.set(currency, found.rate);
  }

  return result;
};

const convertBalance = (
  amountMinor: bigint,
  currency: string,
  primaryCurrency: string | undefined,
  rates: ReadonlyMap<string, string>,
): MoneyDTO | null => {
  // Ya está en la primaria: no hay nada que convertir y repetir el número
  // sugeriría que son dos cifras distintas.
  if (primaryCurrency === undefined || currency === primaryCurrency)
    return null;

  const rate = rates.get(currency);
  if (rate === undefined) return null;

  const converted = convert(
    money(amountMinor, currency),
    rate,
    primaryCurrency,
  );
  if (!converted.ok) return null;

  return {
    amountMinor: converted.value.amountMinor.toString(),
    currency: primaryCurrency,
  };
};

export const getAccount = async (
  db: ScopedDb,
  accountId: string,
  options: {
    readonly primaryCurrency?: string;
    readonly today?: CalendarDate;
  } = {},
): Promise<AccountWithBalance> => {
  const row = await db.account.findFirst({
    where: { id: accountId },
    select: SELECT,
  });

  // 404 sale gratis: el cliente scopeado no ve cuentas de otro Space.
  if (row === null) throw errors.notFound("No se encontró la cuenta");

  const balances = await accountBalances(db, { includeArchived: true });
  const balance = balances.get(row.id);
  const amountMinor = balance?.balanceMinor ?? row.initialBalanceMinor;

  const rates = await ratesFor(
    new Set([row.currency]),
    options.primaryCurrency,
    options.today,
  );

  return {
    ...toDTO(row),
    balancePrimary: convertBalance(
      amountMinor,
      row.currency,
      options.primaryCurrency,
      rates,
    ),
    balance: {
      amountMinor: (
        balance?.balanceMinor ?? row.initialBalanceMinor
      ).toString(),
      currency: row.currency,
    },
    transactionCount: balance?.transactionCount ?? 0,
  };
};

export const createAccount = async (
  db: ScopedDb,
  spaceId: string,
  input: CreateAccountRequest,
  defaultCurrency: string,
): Promise<AccountDTO> => {
  const last = await db.account.findFirst({
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });

  const row = await db.account.create({
    data: {
      spaceId,
      name: input.name,
      type: input.type,
      currency: input.currency ?? defaultCurrency,
      initialBalanceMinor: BigInt(input.initialBalanceMinor ?? "0"),
      color: input.color ?? null,
      icon: input.icon ?? null,
      creditClosingDay: input.creditClosingDay ?? null,
      creditDueDay: input.creditDueDay ?? null,
      includeInNetWorth: input.includeInNetWorth ?? true,
      sortOrder: (last?.sortOrder ?? -1) + 1,
    },
    select: SELECT,
  });

  return toDTO(row);
};

export const updateAccount = async (
  db: ScopedDb,
  accountId: string,
  input: UpdateAccountRequest,
): Promise<AccountDTO> => {
  const existing = await db.account.findFirst({
    where: { id: accountId },
    select: { id: true, type: true },
  });

  if (existing === null) throw errors.notFound("No se encontró la cuenta");

  // Si deja de ser tarjeta, los días de cierre pierden sentido y el CHECK de
  // la base rechazaría la fila. Se limpian acá con un mensaje claro.
  const type = input.type ?? existing.type;
  const clearCreditDays = type !== "CREDIT_CARD";

  const row = await db.account.update({
    where: { id: accountId },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.type !== undefined ? { type: input.type } : {}),
      ...(input.color !== undefined ? { color: input.color } : {}),
      ...(input.icon !== undefined ? { icon: input.icon } : {}),
      ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
      ...(input.initialBalanceMinor !== undefined
        ? { initialBalanceMinor: BigInt(input.initialBalanceMinor) }
        : {}),
      ...(input.includeInNetWorth !== undefined
        ? { includeInNetWorth: input.includeInNetWorth }
        : {}),
      ...(clearCreditDays
        ? { creditClosingDay: null, creditDueDay: null }
        : {
            ...(input.creditClosingDay !== undefined
              ? { creditClosingDay: input.creditClosingDay }
              : {}),
            ...(input.creditDueDay !== undefined
              ? { creditDueDay: input.creditDueDay }
              : {}),
          }),
    },
    select: SELECT,
  });

  return toDTO(row);
};

export const setArchived = async (
  db: ScopedDb,
  accountId: string,
  isArchived: boolean,
): Promise<AccountDTO> => {
  const existing = await db.account.findFirst({
    where: { id: accountId },
    select: { id: true },
  });
  if (existing === null) throw errors.notFound("No se encontró la cuenta");

  const row = await db.account.update({
    where: { id: accountId },
    data: { isArchived },
    select: SELECT,
  });

  return toDTO(row);
};

/**
 * Borrado lógico de una cuenta.
 *
 * Se niega si tiene movimientos: borrarla dejaría transacciones apuntando a
 * una cuenta invisible y los reportes históricos dejarían de cuadrar. Para eso
 * está archivar, que la saca de la vista sin romper nada.
 */
export const deleteAccount = async (
  db: ScopedDb,
  tx: TransactionClient,
  spaceId: string,
  accountId: string,
  actor: { readonly userId: string; readonly name: string },
): Promise<void> => {
  const existing = await db.account.findFirst({
    where: { id: accountId },
    select: { id: true, name: true },
  });

  if (existing === null) throw errors.notFound("No se encontró la cuenta");

  const count = await db.transaction.count({ where: { accountId } });

  if (count > 0) {
    throw errors.conflict(
      "CONFLICT",
      `La cuenta tiene ${String(count)} movimientos. Archivala en vez de eliminarla`,
    );
  }

  await tx.account.update({
    where: { id: accountId },
    data: { deletedAt: new Date() },
  });

  await writeAuditLog(tx, {
    spaceId,
    actorUserId: actor.userId,
    actorName: actor.name,
    action: "ACCOUNT_DELETED",
    entityType: "Account",
    entityId: accountId,
    metadata: { name: existing.name },
  });
};
