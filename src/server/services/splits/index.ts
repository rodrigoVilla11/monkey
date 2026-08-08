import { errors } from "@/server/api/errors";
import type { ScopedDb } from "@/server/db/scoped";
import type { TransactionClient } from "@/server/services/audit/log";
import type { MoneyDTO } from "@/shared/contracts/common";
import type {
  CreateSettlementRequest,
  MemberBalanceDTO,
  SetSplitRequest,
  SettlementDTO,
  SplitSummaryDTO,
  SuggestedPaymentDTO,
  TransactionSplitDTO,
} from "@/shared/contracts/splits";
import { fromCalendarDate, toCalendarDate, todayIn } from "@/shared/dates";
import { money } from "@/shared/money";
import {
  memberBalances,
  settleUp,
  splitByPercentage,
  splitEvenly,
  validateShares,
  type MemberFlow,
  type Share,
  type SplitError,
} from "@/shared/split";

/**
 * Reparto de gastos entre miembros.
 *
 * ── Anotación, no deuda ─────────────────────────────────────────────────────
 *
 * Un reparto dice cuánto de un gasto le toca a cada uno. NO crea una deuda por
 * cada gasto: cincuenta cenas serían cincuenta deudas de siete euros que nadie
 * salda una por una. El saldo entre personas se calcula agregando los repartos
 * y se cancela con un saldado.
 *
 * ── Ni repartir ni saldar mueven el patrimonio ──────────────────────────────
 *
 * El gasto ya está cargado; repartirlo solo anota de quién era. Y saldar es
 * plata que cambia de manos DENTRO del Space: si generara un movimiento, el mes
 * en que se saldan las cuentas parecería el mes de un gasto enorme.
 */

const toMoney = (amountMinor: bigint, currency: string): MoneyDTO => ({
  amountMinor: amountMinor.toString(),
  currency,
});

const SPLIT_ERROR_MESSAGES: Readonly<Record<SplitError, string>> = {
  NO_PARTICIPANTS: "Hace falta al menos un participante",
  DUPLICATE_PARTICIPANT: "Hay un participante repetido",
  SUM_MISMATCH: "Las partes no suman el importe del gasto",
  NON_POSITIVE: "Cada parte tiene que ser mayor que cero",
  INVALID_PERCENTAGE: "Los porcentajes tienen que sumar 100 %",
};

interface SpaceContext {
  readonly spaceId: string;
  readonly primaryCurrency: string;
  readonly timezone: string;
}

/**
 * Los miembros del Space, indexados por usuario.
 *
 * Se leen por `Membership`, que SÍ está scopeado: es la vía autorizada para
 * llegar al nombre y al avatar de una persona desde dentro de un Space, porque
 * `User` es de acceso solo con el cliente de sistema.
 */
const loadMembers = async (
  db: ScopedDb,
): Promise<Map<string, { name: string; avatarUrl: string | null }>> => {
  const memberships = await db.membership.findMany({
    select: { userId: true, user: { select: { name: true, avatarUrl: true } } },
  });

  return new Map(
    memberships.map((membership) => [
      membership.userId,
      {
        name: membership.user.name,
        avatarUrl: membership.user.avatarUrl,
      },
    ]),
  );
};

// ─────────────────────────── repartir un gasto ───────────────────────────────

export const setSplit = async (
  db: ScopedDb,
  tx: TransactionClient,
  space: SpaceContext,
  transactionId: string,
  input: SetSplitRequest,
): Promise<void> => {
  const transaction = await db.transaction.findFirst({
    where: { id: transactionId },
    select: { id: true, type: true, amountMinor: true, currency: true },
  });

  if (transaction === null)
    throw errors.notFound("No se encontró el movimiento");

  /**
   * Solo se reparten gastos. Repartir un ingreso o una transferencia no
   * significa nada: el primero es plata que entró, la segunda no salió del
   * Space.
   */
  if (transaction.type !== "EXPENSE") {
    throw errors.conflict("CONFLICT", "Solo se pueden repartir gastos");
  }

  const members = await loadMembers(db);

  for (const participant of input.participants) {
    if (!members.has(participant.userId)) {
      throw errors.notFound("Algún participante no es miembro de este espacio");
    }
  }

  if (input.paidByUserId !== null && !members.has(input.paidByUserId)) {
    throw errors.notFound("Quien pagó no es miembro de este espacio");
  }

  const total = money(transaction.amountMinor, transaction.currency);
  const result = resolveShares(total, input);

  if (!result.ok) {
    throw errors.conflict("UNPROCESSABLE", SPLIT_ERROR_MESSAGES[result.error]);
  }

  /**
   * Se reemplaza el reparto entero, no se hace un merge. Un reparto parcial
   * mezclado con el anterior dejaría de sumar el importe, que es la única
   * invariante que este módulo tiene que sostener.
   */
  await tx.transactionSplit.deleteMany({
    where: { spaceId: space.spaceId, transactionId },
  });

  await tx.transaction.update({
    where: { id: transactionId },
    data: { paidByUserId: input.paidByUserId },
  });

  await tx.transactionSplit.createMany({
    data: result.shares.map((share) => ({
      spaceId: space.spaceId,
      transactionId,
      userId: share.userId,
      amountMinor: share.amountMinor,
    })),
  });
};

const resolveShares = (
  total: ReturnType<typeof money>,
  input: SetSplitRequest,
): ReturnType<typeof splitEvenly> => {
  switch (input.mode) {
    case "EVEN":
      return splitEvenly(
        total,
        input.participants.map((p) => p.userId),
      );

    case "PERCENTAGE":
      return splitByPercentage(
        total,
        input.participants.map((p) => ({ userId: p.userId, bps: p.bps ?? 0 })),
      );

    case "EXACT": {
      const shares: Share[] = input.participants.map((p) => ({
        userId: p.userId,
        amountMinor: BigInt(p.amountMinor ?? "0"),
      }));
      return validateShares(total, shares);
    }
  }
};

/** Quita el reparto de un gasto. El gasto queda como estaba. */
export const clearSplit = async (
  db: ScopedDb,
  tx: TransactionClient,
  spaceId: string,
  transactionId: string,
): Promise<void> => {
  const transaction = await db.transaction.findFirst({
    where: { id: transactionId },
    select: { id: true },
  });
  if (transaction === null)
    throw errors.notFound("No se encontró el movimiento");

  await tx.transactionSplit.deleteMany({ where: { spaceId, transactionId } });
  await tx.transaction.update({
    where: { id: transactionId },
    data: { paidByUserId: null },
  });
};

export const getSplit = async (
  db: ScopedDb,
  transactionId: string,
): Promise<TransactionSplitDTO> => {
  const transaction = await db.transaction.findFirst({
    where: { id: transactionId },
    select: {
      id: true,
      amountMinor: true,
      currency: true,
      paidByUserId: true,
    },
  });

  if (transaction === null)
    throw errors.notFound("No se encontró el movimiento");

  const [members, splits] = await Promise.all([
    loadMembers(db),
    db.transactionSplit.findMany({
      where: { transactionId },
      select: { userId: true, amountMinor: true },
    }),
  ]);

  const paidBy =
    transaction.paidByUserId === null
      ? null
      : {
          userId: transaction.paidByUserId,
          name: members.get(transaction.paidByUserId)?.name ?? "Ex miembro",
          avatarUrl: members.get(transaction.paidByUserId)?.avatarUrl ?? null,
        };

  return {
    transactionId,
    total: toMoney(transaction.amountMinor, transaction.currency),
    paidBy,
    shares: splits.map((split) => ({
      userId: split.userId,
      name: members.get(split.userId)?.name ?? "Ex miembro",
      avatarUrl: members.get(split.userId)?.avatarUrl ?? null,
      amount: toMoney(split.amountMinor, transaction.currency),
      percentage: percentageOf(split.amountMinor, transaction.amountMinor),
    })),
  };
};

const percentageOf = (partMinor: bigint, totalMinor: bigint): number => {
  if (totalMinor <= 0n) return 0;
  return Number((partMinor * 1000n + totalMinor / 2n) / totalMinor) / 10;
};

// ──────────────────────────── quién debe a quién ─────────────────────────────

/**
 * El resumen entero: saldos, pagos sugeridos e historial de saldados.
 *
 * **Solo entran los gastos en la moneda primaria.** Sumar monedas distintas
 * exige una cotización, y decirle a alguien que debe una cifra convertida a ojo
 * es peor que no decirle nada.
 */
export const splitSummary = async (
  db: ScopedDb,
  space: SpaceContext,
): Promise<SplitSummaryDTO> => {
  const members = await loadMembers(db);

  const [paidRows, owedRows, settlementRows, splitCount] = await Promise.all([
    // Lo que puso cada uno: gastos con reparto y con pagador conocido.
    db.transaction.groupBy({
      by: ["paidByUserId"],
      where: {
        type: "EXPENSE",
        paidByUserId: { not: null },
        currency: space.primaryCurrency,
        splits: { some: {} },
      },
      _sum: { amountMinor: true },
    }),
    // Lo que le tocaba a cada uno.
    db.transactionSplit.groupBy({
      by: ["userId"],
      where: { transaction: { currency: space.primaryCurrency } },
      _sum: { amountMinor: true },
    }),
    db.settlement.findMany({
      where: { currency: space.primaryCurrency },
      orderBy: [{ date: "desc" }, { id: "desc" }],
      select: {
        id: true,
        fromUserId: true,
        toUserId: true,
        amountMinor: true,
        date: true,
        note: true,
        createdAt: true,
      },
    }),
    db.transaction.count({
      where: { type: "EXPENSE", splits: { some: {} } },
    }),
  ]);

  const paidByUser = new Map(
    paidRows
      .filter(
        (row): row is typeof row & { paidByUserId: string } =>
          row.paidByUserId !== null,
      )
      .map((row) => [row.paidByUserId, row._sum.amountMinor ?? 0n]),
  );
  const owedByUser = new Map(
    owedRows.map((row) => [row.userId, row._sum.amountMinor ?? 0n]),
  );

  const userIds = new Set([
    ...paidByUser.keys(),
    ...owedByUser.keys(),
    ...settlementRows.flatMap((row) => [row.fromUserId, row.toUserId]),
  ]);

  const flows: MemberFlow[] = [...userIds].map((userId) => ({
    userId,
    paidMinor: paidByUser.get(userId) ?? 0n,
    owedMinor: owedByUser.get(userId) ?? 0n,
  }));

  const balances = memberBalances(
    flows,
    settlementRows.map((row) => ({
      fromUserId: row.fromUserId,
      toUserId: row.toUserId,
      amountMinor: row.amountMinor,
    })),
  );

  const nameOf = (userId: string): string =>
    members.get(userId)?.name ?? "Ex miembro";

  return {
    currency: space.primaryCurrency,
    balances: balances.map((balance): MemberBalanceDTO => ({
      userId: balance.userId,
      name: nameOf(balance.userId),
      avatarUrl: members.get(balance.userId)?.avatarUrl ?? null,
      paid: toMoney(balance.paidMinor, space.primaryCurrency),
      owed: toMoney(balance.owedMinor, space.primaryCurrency),
      net: toMoney(balance.netMinor, space.primaryCurrency),
    })),
    suggested: settleUp(balances).map((payment): SuggestedPaymentDTO => ({
      from: { userId: payment.fromUserId, name: nameOf(payment.fromUserId) },
      to: { userId: payment.toUserId, name: nameOf(payment.toUserId) },
      amount: toMoney(payment.amountMinor, space.primaryCurrency),
    })),
    settlements: settlementRows.map((row): SettlementDTO => ({
      id: row.id,
      from: { userId: row.fromUserId, name: nameOf(row.fromUserId) },
      to: { userId: row.toUserId, name: nameOf(row.toUserId) },
      amount: toMoney(row.amountMinor, space.primaryCurrency),
      date: toCalendarDate(row.date),
      note: row.note,
      createdAt: row.createdAt.toISOString(),
    })),
    splitCount,
  };
};

// ────────────────────────────── saldar ───────────────────────────────────────

export const createSettlement = async (
  db: ScopedDb,
  tx: TransactionClient,
  space: SpaceContext,
  actor: { readonly userId: string },
  input: CreateSettlementRequest,
): Promise<string> => {
  const members = await loadMembers(db);

  if (!members.has(input.fromUserId) || !members.has(input.toUserId)) {
    throw errors.notFound("Alguna de las dos personas no es miembro");
  }

  const created = await tx.settlement.create({
    data: {
      spaceId: space.spaceId,
      fromUserId: input.fromUserId,
      toUserId: input.toUserId,
      amountMinor: BigInt(input.amountMinor),
      currency: space.primaryCurrency,
      date: fromCalendarDate(input.date ?? todayIn(space.timezone)),
      note: input.note ?? null,
      createdByUserId: actor.userId,
    },
    select: { id: true },
  });

  return created.id;
};

export const deleteSettlement = async (
  db: ScopedDb,
  tx: TransactionClient,
  id: string,
): Promise<void> => {
  const existing = await db.settlement.findFirst({
    where: { id },
    select: { id: true },
  });
  if (existing === null) throw errors.notFound("No se encontró el saldado");

  // Borrado real: un saldado que no ocurrió no debería dejar rastro, y quitarlo
  // devuelve el saldo a lo que era.
  await tx.settlement.delete({ where: { id } });
};
