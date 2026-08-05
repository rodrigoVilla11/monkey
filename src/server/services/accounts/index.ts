import { errors } from "@/server/api/errors";
import type { ScopedDb } from "@/server/db/scoped";
import {
  writeAuditLog,
  type TransactionClient,
} from "@/server/services/audit/log";
import { accountBalances } from "@/server/services/balances";
import type {
  AccountDTO,
  AccountWithBalance,
  CreateAccountRequest,
  UpdateAccountRequest,
} from "@/shared/contracts/accounts";

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
  creditClosingDay: true,
  creditDueDay: true,
  createdAt: true,
} as const;

export const listAccounts = async (
  db: ScopedDb,
  options: { readonly includeArchived?: boolean } = {},
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

  return rows.map((row) => {
    const balance = balances.get(row.id);
    return {
      ...toDTO(row),
      balance: {
        amountMinor: (
          balance?.balanceMinor ?? row.initialBalanceMinor
        ).toString(),
        currency: row.currency,
      },
      transactionCount: balance?.transactionCount ?? 0,
    };
  });
};

export const getAccount = async (
  db: ScopedDb,
  accountId: string,
): Promise<AccountWithBalance> => {
  const row = await db.account.findFirst({
    where: { id: accountId },
    select: SELECT,
  });

  // 404 sale gratis: el cliente scopeado no ve cuentas de otro Space.
  if (row === null) throw errors.notFound("No se encontró la cuenta");

  const balances = await accountBalances(db, { includeArchived: true });
  const balance = balances.get(row.id);

  return {
    ...toDTO(row),
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
