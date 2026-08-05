import { errors } from "@/server/api/errors";
import type { ScopedDb } from "@/server/db/scoped";
import {
  budgetStatus,
  currentPeriod,
  elapsedPeriods,
  hasEnded,
  nextPeriodStart,
  type BudgetPeriodKind,
} from "@/shared/budget";
import type {
  BudgetSummary,
  BudgetWithStatus,
  CreateBudgetRequest,
  UpdateBudgetRequest,
} from "@/shared/contracts/budgets";
import type { MoneyDTO } from "@/shared/contracts/common";
import {
  fromCalendarDate,
  toCalendarDate,
  todayIn,
  type CalendarDate,
} from "@/shared/dates";

/**
 * Presupuestos.
 *
 * Dos decisiones que definen todo lo demás:
 *
 * 1. **Un presupuesto sobre una categoría padre incluye sus hijas.** Un tope
 *    de "Alimentación" cuenta también "Supermercado" y "Restaurantes": nadie
 *    piensa su presupuesto de comida como excluyendo el súper.
 *
 * 2. **La moneda del presupuesto es la primaria del Space.** Se valida al
 *    crear. El gasto se suma sobre `amountPrimaryMinor` cuando el movimiento
 *    está en otra moneda, así que comparar contra un tope en una tercera
 *    moneda no significaría nada.
 */

const SELECT = {
  id: true,
  name: true,
  period: true,
  amountMinor: true,
  currency: true,
  rollover: true,
  isActive: true,
  startDate: true,
  endDate: true,
  categoryId: true,
  category: { select: { id: true, name: true, color: true, icon: true } },
} as const;

const money = (amountMinor: bigint, currency: string): MoneyDTO => ({
  amountMinor: amountMinor.toString(),
  currency,
});

/**
 * IDs de categorías que cuentan para un presupuesto: la propia y sus hijas.
 * Null significa presupuesto global, sin filtro de categoría.
 */
const categoryScope = async (
  db: ScopedDb,
  categoryId: string | null,
): Promise<string[] | null> => {
  if (categoryId === null) return null;

  const children = await db.category.findMany({
    where: { parentId: categoryId },
    select: { id: true },
  });

  return [categoryId, ...children.map((c) => c.id)];
};

/**
 * Gasto de un presupuesto en dos ventanas de una sola pasada: el período
 * actual y todo lo acumulado desde el inicio.
 *
 * Se hace con dos agregados en paralelo y no trayendo filas: un presupuesto de
 * hace un año sobre una categoría muy usada puede tener miles de movimientos.
 *
 * Las TRANSFERENCIAS quedan fuera por definición: mover plata entre cuentas
 * propias no consume presupuesto.
 */
const spendFor = async (
  db: ScopedDb,
  categoryIds: string[] | null,
  from: CalendarDate,
  periodStart: CalendarDate,
  periodEnd: CalendarDate,
): Promise<{ periodSpentMinor: bigint; totalSpentMinor: bigint }> => {
  const scope = {
    type: "EXPENSE" as const,
    ...(categoryIds !== null ? { categoryId: { in: categoryIds } } : {}),
  };

  const [period, total] = await Promise.all([
    db.transaction.aggregate({
      where: {
        ...scope,
        date: {
          gte: fromCalendarDate(periodStart),
          lte: fromCalendarDate(periodEnd),
        },
      },
      _sum: { amountMinor: true, amountPrimaryMinor: true },
    }),
    db.transaction.aggregate({
      where: {
        ...scope,
        date: { gte: fromCalendarDate(from), lte: fromCalendarDate(periodEnd) },
      },
      _sum: { amountMinor: true, amountPrimaryMinor: true },
    }),
  ]);

  /**
   * `amountPrimaryMinor` solo está poblado cuando la moneda del movimiento
   * difiere de la primaria. Sumar los dos campos y quedarse con el convertido
   * cuando existe da el total en moneda primaria sin conversiones al vuelo.
   */
  const resolve = (sums: {
    amountMinor: bigint | null;
    amountPrimaryMinor: bigint | null;
  }): bigint => {
    const converted = sums.amountPrimaryMinor ?? 0n;
    return converted > 0n ? converted : (sums.amountMinor ?? 0n);
  };

  return {
    periodSpentMinor: resolve(period._sum),
    totalSpentMinor: resolve(total._sum),
  };
};

interface BudgetRow {
  id: string;
  name: string;
  period: string;
  amountMinor: bigint;
  currency: string;
  rollover: boolean;
  isActive: boolean;
  startDate: Date;
  endDate: Date | null;
  categoryId: string | null;
  category: {
    id: string;
    name: string;
    color: string | null;
    icon: string | null;
  } | null;
}

const withStatus = async (
  db: ScopedDb,
  row: BudgetRow,
  today: CalendarDate,
): Promise<BudgetWithStatus> => {
  const kind = row.period as BudgetPeriodKind;
  const startDate = toCalendarDate(row.startDate);
  const endDate = row.endDate === null ? null : toCalendarDate(row.endDate);

  const period = currentPeriod(kind, startDate, endDate, today);
  const elapsed = elapsedPeriods(kind, startDate, today);

  const categoryIds = await categoryScope(db, row.categoryId);
  const spend = await spendFor(
    db,
    categoryIds,
    startDate,
    period.start,
    period.end,
  );

  const status = budgetStatus({
    amountMinor: row.amountMinor,
    rollover: row.rollover,
    elapsedPeriods: elapsed,
    ...spend,
  });

  return {
    id: row.id,
    name: row.name,
    period: kind,
    amount: money(row.amountMinor, row.currency),
    rollover: row.rollover,
    isActive: row.isActive,
    startDate,
    endDate,
    category: row.category,
    periodStart: period.start,
    periodEnd: period.end,
    nextPeriodStart: nextPeriodStart(kind, period),
    effectiveAmount: money(status.effectiveAmountMinor, row.currency),
    spent: money(status.periodSpentMinor, row.currency),
    remaining: money(status.remainingMinor, row.currency),
    carried: money(status.carriedMinor, row.currency),
    percentage: status.percentage,
    state: status.state,
    hasEnded: hasEnded(endDate, today),
  };
};

export const listBudgets = async (
  db: ScopedDb,
  viewerTimezone: string,
  options: { readonly includeInactive?: boolean } = {},
): Promise<BudgetWithStatus[]> => {
  const rows = await db.budget.findMany({
    where: options.includeInactive === true ? {} : { isActive: true },
    orderBy: [{ createdAt: "asc" }],
    select: SELECT,
  });

  // "Hoy" en la timezone de quien mira: el 1 de mes a las 00:30 en Madrid, un
  // server en UTC mostraría todavía el período anterior.
  const today = todayIn(viewerTimezone);

  // Secuencial y no en paralelo: cada presupuesto hace 3 consultas y una
  // ráfaga de 20 presupuestos × 3 saturaría el pool de conexiones.
  const result: BudgetWithStatus[] = [];
  for (const row of rows) {
    result.push(await withStatus(db, row, today));
  }
  return result;
};

export const getBudget = async (
  db: ScopedDb,
  viewerTimezone: string,
  budgetId: string,
): Promise<BudgetWithStatus> => {
  const row = await db.budget.findFirst({
    where: { id: budgetId },
    select: SELECT,
  });

  if (row === null) throw errors.notFound("No se encontró el presupuesto");
  return withStatus(db, row, todayIn(viewerTimezone));
};

/** Resumen para la tarjeta del dashboard. */
export const budgetSummary = async (
  db: ScopedDb,
  viewerTimezone: string,
  primaryCurrency: string,
): Promise<BudgetSummary> => {
  const budgets = await listBudgets(db, viewerTimezone);

  let totalAmount = 0n;
  let totalSpent = 0n;
  let overBudget = 0;
  let nearLimit = 0;

  for (const budget of budgets) {
    if (budget.hasEnded) continue;
    totalAmount += BigInt(budget.effectiveAmount.amountMinor);
    totalSpent += BigInt(budget.spent.amountMinor);
    if (budget.state === "OVER") overBudget += 1;
    else if (budget.state === "WARNING") nearLimit += 1;
  }

  return {
    total: budgets.filter((b) => !b.hasEnded).length,
    overBudget,
    nearLimit,
    totalAmount: money(totalAmount, primaryCurrency),
    totalSpent: money(totalSpent, primaryCurrency),
  };
};

// ────────────────────────────── mutaciones ───────────────────────────────────

const validateCategory = async (
  db: ScopedDb,
  categoryId: string,
): Promise<void> => {
  const category = await db.category.findFirst({
    where: { id: categoryId },
    select: { id: true, kind: true },
  });

  // 404 y no 403: el cliente scopeado no ve categorías de otro Space.
  if (category === null) throw errors.notFound("No se encontró la categoría");

  if (category.kind !== "EXPENSE") {
    throw errors.conflict(
      "CONFLICT",
      "Solo se pueden presupuestar categorías de gasto",
    );
  }
};

export const createBudget = async (
  db: ScopedDb,
  spaceId: string,
  primaryCurrency: string,
  viewerTimezone: string,
  input: CreateBudgetRequest,
): Promise<BudgetWithStatus> => {
  if (input.categoryId != null) {
    await validateCategory(db, input.categoryId);

    // Un segundo presupuesto activo sobre la misma categoría daría dos topes
    // simultáneos y dos alertas contradictorias.
    const existing = await db.budget.findFirst({
      where: { categoryId: input.categoryId, isActive: true },
      select: { id: true },
    });
    if (existing !== null) {
      throw errors.conflict(
        "CONFLICT",
        "Esa categoría ya tiene un presupuesto activo",
      );
    }
  }

  const startDate = input.startDate ?? todayIn(viewerTimezone);

  const row = await db.budget.create({
    data: {
      spaceId,
      name: input.name,
      categoryId: input.categoryId ?? null,
      period: input.period,
      amountMinor: BigInt(input.amountMinor),
      // Siempre la primaria del Space: ver la nota de arriba.
      currency: primaryCurrency,
      startDate: fromCalendarDate(startDate),
      endDate: input.endDate == null ? null : fromCalendarDate(input.endDate),
      rollover: input.rollover ?? false,
    },
    select: SELECT,
  });

  return withStatus(db, row, todayIn(viewerTimezone));
};

export const updateBudget = async (
  db: ScopedDb,
  viewerTimezone: string,
  budgetId: string,
  input: UpdateBudgetRequest,
): Promise<BudgetWithStatus> => {
  const existing = await db.budget.findFirst({
    where: { id: budgetId },
    select: { id: true, period: true, endDate: true },
  });

  if (existing === null) throw errors.notFound("No se encontró el presupuesto");

  if (input.categoryId != null) await validateCategory(db, input.categoryId);

  // El CHECK de la base exige fecha de fin en los CUSTOM; se comprueba acá
  // contra el estado resultante para dar un mensaje entendible.
  const period = input.period ?? existing.period;
  const endDate =
    input.endDate !== undefined
      ? input.endDate
      : existing.endDate === null
        ? null
        : toCalendarDate(existing.endDate);

  if (period === "CUSTOM" && endDate === null) {
    throw errors.conflict(
      "UNPROCESSABLE",
      "Un presupuesto de período fijo necesita fecha de fin",
    );
  }

  const row = await db.budget.update({
    where: { id: budgetId },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.categoryId !== undefined
        ? { categoryId: input.categoryId }
        : {}),
      ...(input.period !== undefined ? { period: input.period } : {}),
      ...(input.amountMinor !== undefined
        ? { amountMinor: BigInt(input.amountMinor) }
        : {}),
      ...(input.rollover !== undefined ? { rollover: input.rollover } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      ...(input.startDate !== undefined
        ? { startDate: fromCalendarDate(input.startDate) }
        : {}),
      ...(input.endDate !== undefined
        ? {
            endDate:
              input.endDate === null ? null : fromCalendarDate(input.endDate),
          }
        : {}),
    },
    select: SELECT,
  });

  return withStatus(db, row, todayIn(viewerTimezone));
};

/**
 * Borrado lógico. No se toca ningún movimiento: un presupuesto es una vista
 * sobre los gastos, no un dato de los gastos.
 */
export const deleteBudget = async (
  db: ScopedDb,
  budgetId: string,
): Promise<void> => {
  const existing = await db.budget.findFirst({
    where: { id: budgetId },
    select: { id: true },
  });

  if (existing === null) throw errors.notFound("No se encontró el presupuesto");

  await db.budget.update({
    where: { id: budgetId },
    data: { deletedAt: new Date() },
  });
};
