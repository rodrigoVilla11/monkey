import { errors } from "@/server/api/errors";
import type { ScopedDb } from "@/server/db/scoped";
import type { TransactionClient } from "@/server/services/audit/log";
import type { MoneyDTO } from "@/shared/contracts/common";
import type {
  ContributionDTO,
  CreateContributionRequest,
  CreateSavingsGoalRequest,
  SavingsGoalDetail,
  SavingsGoalDTO,
  SavingsGoalFilters,
  SavingsSummary,
  UpdateSavingsGoalRequest,
} from "@/shared/contracts/savings";
import {
  fromCalendarDate,
  toCalendarDate,
  todayIn,
  type CalendarDate,
} from "@/shared/dates";
import { goalForecast, goalProgress } from "@/shared/savings";

/**
 * Metas de ahorro.
 *
 * ── La regla que define el módulo ───────────────────────────────────────────
 *
 * **Un aporte nunca crea un movimiento.** Apartar plata no es gastarla: sigue
 * siendo tuya, solo cambió de bolsillo. Si aportar generara un EXPENSE, el mes
 * en que más ahorraste sería el mes en que más gastaste, y el patrimonio bajaría
 * por guardar plata.
 *
 * Lo que sí hace es al revés: un aporte se VINCULA a un movimiento que ya
 * existe —normalmente la transferencia a la cuenta de ahorro, que el incremento
 * 11 ya sabe crear— y de ahí saca el importe. Así el número del aporte y el del
 * movimiento no pueden discrepar.
 *
 * ── Moneda ──────────────────────────────────────────────────────────────────
 *
 * Los aportes están en la moneda de la META. Al vincular un movimiento de otra
 * moneda se usa su importe YA convertido y congelado (`amountPrimaryMinor`), que
 * solo existe si la meta está en la moneda primaria del Space. Si no se puede
 * resolver sin inventar una cotización, se rechaza: es preferible pedirle a la
 * persona que cargue el aporte a mano que meter un número aproximado en una
 * barra de progreso.
 */

const GOAL_SELECT = {
  id: true,
  name: true,
  icon: true,
  color: true,
  targetAmountMinor: true,
  currency: true,
  targetDate: true,
  achievedAt: true,
  createdAt: true,
  account: { select: { id: true, name: true, currency: true } },
} as const;

interface GoalRow {
  id: string;
  name: string;
  icon: string | null;
  color: string | null;
  targetAmountMinor: bigint;
  currency: string;
  targetDate: Date | null;
  achievedAt: Date | null;
  createdAt: Date;
  account: { id: string; name: string; currency: string } | null;
}

/** Lo que hace falta saber de los aportes de una meta para armar su DTO. */
interface Rollup {
  readonly savedMinor: bigint;
  readonly count: number;
  readonly firstDate: CalendarDate | null;
}

const money = (amountMinor: bigint, currency: string): MoneyDTO => ({
  amountMinor: amountMinor.toString(),
  currency,
});

const toDTO = (
  row: GoalRow,
  rollup: Rollup,
  today: CalendarDate,
): SavingsGoalDTO => {
  const progress = goalProgress(rollup.savedMinor, row.targetAmountMinor);
  const targetDate =
    row.targetDate === null ? null : toCalendarDate(row.targetDate);

  const forecast = goalForecast({
    savedMinor: rollup.savedMinor,
    targetMinor: row.targetAmountMinor,
    targetDate,
    firstContributionDate: rollup.firstDate,
    today,
  });

  return {
    id: row.id,
    name: row.name,
    icon: row.icon,
    color: row.color,
    target: money(row.targetAmountMinor, row.currency),
    saved: money(progress.savedMinor, row.currency),
    remaining: money(progress.remainingMinor, row.currency),
    surplus: money(progress.surplusMinor, row.currency),
    percentage: progress.percentage,
    achieved: progress.achieved,
    achievedAt: row.achievedAt?.toISOString() ?? null,
    targetDate,
    account: row.account,
    contributionCount: rollup.count,
    pace: forecast.pace,
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

/**
 * Totales de aportes de varias metas en UNA consulta.
 *
 * Un `groupBy` y no una consulta por meta: la pantalla de metas mostraría N+1
 * consultas apenas alguien tenga cuatro objetivos.
 */
const rollupsFor = async (
  db: ScopedDb,
  goalIds: readonly string[],
): Promise<Map<string, Rollup>> => {
  const result = new Map<string, Rollup>();
  if (goalIds.length === 0) return result;

  const grouped = await db.savingsContribution.groupBy({
    by: ["goalId"],
    where: { goalId: { in: [...goalIds] } },
    _sum: { amountMinor: true },
    _count: { _all: true },
    _min: { date: true },
  });

  for (const row of grouped) {
    result.set(row.goalId, {
      savedMinor: row._sum.amountMinor ?? 0n,
      count: row._count._all,
      firstDate: row._min.date === null ? null : toCalendarDate(row._min.date),
    });
  }

  return result;
};

const EMPTY: Rollup = { savedMinor: 0n, count: 0, firstDate: null };

export const listSavingsGoals = async (
  db: ScopedDb,
  timezone: string,
  filters: SavingsGoalFilters,
): Promise<SavingsGoalDTO[]> => {
  const rows = await db.savingsGoal.findMany({
    where: filters.includeAchieved === true ? {} : { achievedAt: null },
    // Las que tienen fecha primero y por urgencia; las sin plazo, al final.
    orderBy: [
      { targetDate: { sort: "asc", nulls: "last" } },
      { createdAt: "asc" },
    ],
    select: GOAL_SELECT,
  });

  const rollups = await rollupsFor(
    db,
    rows.map((row) => row.id),
  );
  const today = todayIn(timezone);

  return rows.map((row) => toDTO(row, rollups.get(row.id) ?? EMPTY, today));
};

export const getSavingsGoal = async (
  db: ScopedDb,
  timezone: string,
  id: string,
): Promise<SavingsGoalDetail> => {
  const row = await db.savingsGoal.findFirst({
    where: { id },
    select: GOAL_SELECT,
  });
  if (row === null) throw errors.notFound("No se encontró la meta");

  const rollups = await rollupsFor(db, [id]);
  const dto = toDTO(row, rollups.get(id) ?? EMPTY, todayIn(timezone));

  const contributions = await db.savingsContribution.findMany({
    where: { goalId: id },
    orderBy: [{ date: "desc" }, { id: "desc" }],
    select: {
      id: true,
      amountMinor: true,
      date: true,
      note: true,
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
    contributions: contributions.map((item): ContributionDTO => ({
      id: item.id,
      amount: money(item.amountMinor, row.currency),
      date: toCalendarDate(item.date),
      note: item.note,
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

/** Verifica que la cuenta, si viene, sea del Space y utilizable. */
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

export const createSavingsGoal = async (
  db: ScopedDb,
  tx: TransactionClient,
  space: SpaceContext,
  input: CreateSavingsGoalRequest,
): Promise<string> => {
  await validateAccount(db, input.accountId);

  const created = await tx.savingsGoal.create({
    data: {
      spaceId: space.spaceId,
      accountId: input.accountId ?? null,
      name: input.name,
      targetAmountMinor: BigInt(input.targetAmountMinor),
      currency: input.currency ?? space.primaryCurrency,
      targetDate:
        input.targetDate == null ? null : fromCalendarDate(input.targetDate),
      icon: input.icon ?? null,
      color: input.color ?? null,
    },
    select: { id: true },
  });

  return created.id;
};

export const updateSavingsGoal = async (
  db: ScopedDb,
  tx: TransactionClient,
  spaceId: string,
  id: string,
  input: UpdateSavingsGoalRequest,
): Promise<void> => {
  const existing = await db.savingsGoal.findFirst({
    where: { id },
    select: { id: true },
  });
  if (existing === null) throw errors.notFound("No se encontró la meta");

  await validateAccount(db, input.accountId);

  await tx.savingsGoal.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.targetAmountMinor !== undefined
        ? { targetAmountMinor: BigInt(input.targetAmountMinor) }
        : {}),
      ...(input.accountId !== undefined ? { accountId: input.accountId } : {}),
      ...(input.targetDate !== undefined
        ? {
            targetDate:
              input.targetDate === null
                ? null
                : fromCalendarDate(input.targetDate),
          }
        : {}),
      ...(input.icon !== undefined ? { icon: input.icon } : {}),
      ...(input.color !== undefined ? { color: input.color } : {}),
    },
  });

  // Subir el objetivo puede desmarcar una meta que estaba alcanzada.
  await refreshAchieved(tx, spaceId, id);
};

export const deleteSavingsGoal = async (
  db: ScopedDb,
  tx: TransactionClient,
  id: string,
): Promise<void> => {
  const existing = await db.savingsGoal.findFirst({
    where: { id },
    select: { id: true },
  });
  if (existing === null) throw errors.notFound("No se encontró la meta");

  /**
   * Borrado lógico de la meta. Los aportes se van con ella —son suyos y no
   * significan nada solos— pero los MOVIMIENTOS vinculados no se tocan: son
   * transferencias reales que ya movieron saldos.
   */
  await tx.savingsGoal.update({
    where: { id },
    data: { deletedAt: new Date() },
  });
};

// ─────────────────────────────── aportes ─────────────────────────────────────

export const addContribution = async (
  db: ScopedDb,
  tx: TransactionClient,
  space: SpaceContext,
  goalId: string,
  timezone: string,
  input: CreateContributionRequest,
): Promise<string> => {
  const goal = await db.savingsGoal.findFirst({
    where: { id: goalId },
    select: { id: true, currency: true },
  });
  if (goal === null) throw errors.notFound("No se encontró la meta");

  /**
   * El unique parcial de la base es la garantía; esto es solo para dar un
   * mensaje que se entienda. Sin el chequeo previo el usuario vería "eso ya
   * existe" sin saber qué, y sin el índice dos peticiones simultáneas sí
   * lograrían contar el mismo movimiento dos veces.
   */
  if (input.transactionId !== undefined) {
    const already = await db.savingsContribution.findFirst({
      where: { transactionId: input.transactionId },
      select: { goalId: true },
    });

    if (already !== null) {
      throw errors.conflict(
        "CONFLICT",
        already.goalId === goalId
          ? "Ese movimiento ya está contado en esta meta"
          : "Ese movimiento ya está contado en otra meta",
      );
    }
  }

  const resolved = await resolveAmount(db, space, goal.currency, input);

  const created = await tx.savingsContribution.create({
    data: {
      spaceId: space.spaceId,
      goalId,
      transactionId: input.transactionId ?? null,
      amountMinor: resolved.amountMinor,
      date: fromCalendarDate(resolved.date ?? input.date ?? todayIn(timezone)),
      note: input.note ?? null,
    },
    select: { id: true },
  });

  await refreshAchieved(tx, space.spaceId, goalId);

  return created.id;
};

/**
 * Importe y fecha del aporte.
 *
 * Vinculado a un movimiento, los dos salen de él: escribirlos a mano permitiría
 * que el aporte diga 200 y la transferencia 180.
 */
const resolveAmount = async (
  db: ScopedDb,
  space: SpaceContext,
  goalCurrency: string,
  input: CreateContributionRequest,
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

  if (transaction.currency === goalCurrency) {
    return {
      amountMinor: transaction.amountMinor,
      date: toCalendarDate(transaction.date),
    };
  }

  /**
   * Monedas distintas: solo se puede resolver si la meta está en la moneda
   * primaria, porque ahí el movimiento ya trae su importe convertido Y
   * congelado. Inventar una conversión nueva metería un número aproximado en
   * una barra de progreso.
   */
  if (
    goalCurrency === space.primaryCurrency &&
    transaction.amountPrimaryMinor !== null
  ) {
    return {
      amountMinor: transaction.amountPrimaryMinor,
      date: toCalendarDate(transaction.date),
    };
  }

  throw errors.conflict(
    "UNPROCESSABLE",
    `El movimiento está en ${transaction.currency} y la meta en ${goalCurrency}: cargá el aporte con el importe que quieras sumar`,
  );
};

export const removeContribution = async (
  db: ScopedDb,
  tx: TransactionClient,
  spaceId: string,
  goalId: string,
  contributionId: string,
): Promise<void> => {
  const existing = await db.savingsContribution.findFirst({
    where: { id: contributionId, goalId },
    select: { id: true },
  });
  if (existing === null) throw errors.notFound("No se encontró el aporte");

  // Los aportes no tienen borrado lógico: no son hechos económicos, son una
  // anotación sobre uno. El movimiento vinculado, si lo hay, sigue intacto.
  await tx.savingsContribution.delete({ where: { id: contributionId } });

  await refreshAchieved(tx, spaceId, goalId);
};

/**
 * Recalcula `achievedAt` después de cualquier cambio.
 *
 * Se marca al llegar al objetivo y se DESMARCA si el total vuelve a bajar —por
 * un retiro o porque se subió la meta—. Dejarla marcada con la barra al 60 %
 * sería una contradicción en pantalla; la fecha original se pierde, que es un
 * precio menor.
 *
 * **Lee por `tx` y no por el cliente scopeado.** El aporte que acaba de
 * escribirse todavía no está confirmado: leyéndolo desde afuera de la
 * transacción se ve el estado ANTERIOR, y la meta nunca se marcaría ni se
 * desmarcaría. Como `tx` no está scopeado, el `spaceId` va explícito —la misma
 * regla que rige en el SQL crudo de reportes.
 */
const refreshAchieved = async (
  tx: TransactionClient,
  spaceId: string,
  goalId: string,
): Promise<void> => {
  const goal = await tx.savingsGoal.findFirst({
    where: { id: goalId, spaceId, deletedAt: null },
    select: { targetAmountMinor: true, achievedAt: true },
  });
  if (goal === null) return;

  const total = await tx.savingsContribution.aggregate({
    where: { goalId, spaceId },
    _sum: { amountMinor: true },
  });

  const reached = (total._sum.amountMinor ?? 0n) >= goal.targetAmountMinor;

  if (reached && goal.achievedAt === null) {
    await tx.savingsGoal.update({
      where: { id: goalId },
      data: { achievedAt: new Date() },
    });
  } else if (!reached && goal.achievedAt !== null) {
    await tx.savingsGoal.update({
      where: { id: goalId },
      data: { achievedAt: null },
    });
  }
};

// ─────────────────────────────── resumen ─────────────────────────────────────

/**
 * Resumen para el dashboard.
 *
 * Los totales solo se suman entre metas de la MISMA moneda que la primaria: dos
 * metas en monedas distintas no se suman sin una cotización, y esta tarjeta no
 * es lugar para inventar una.
 */
export const savingsSummary = async (
  db: ScopedDb,
  space: SpaceContext,
  timezone: string,
): Promise<SavingsSummary> => {
  const goals = await listSavingsGoals(db, timezone, {});

  let totalTarget = 0n;
  let totalSaved = 0n;
  let behind = 0;

  for (const goal of goals) {
    if (goal.pace === "BEHIND" || goal.pace === "OVERDUE") behind += 1;
    if (goal.target.currency !== space.primaryCurrency) continue;
    totalTarget += BigInt(goal.target.amountMinor);
    totalSaved += BigInt(goal.saved.amountMinor);
  }

  const achieved = await db.savingsGoal.count({
    where: { achievedAt: { not: null } },
  });

  return {
    total: goals.length,
    achieved,
    behind,
    totalTarget: money(totalTarget, space.primaryCurrency),
    totalSaved: money(totalSaved, space.primaryCurrency),
  };
};
