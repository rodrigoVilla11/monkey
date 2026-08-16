import type { ScopedDb } from "@/server/db/scoped";
import { accountBalances } from "@/server/services/balances";
import { budgetSummary } from "@/server/services/budgets";
import { getRateProvider } from "@/server/services/rates";
import { goalReminders } from "@/server/services/savings";
import { reservedByAccount } from "@/server/services/savings/reserved";
import { groupSumInPrimary } from "./aggregate";
import { percentageOf } from "@/shared/balance";
import type { MoneyDTO } from "@/shared/contracts/common";
import type {
  AccountBalanceSummary,
  CategoryBreakdownItem,
  DashboardResponse,
  MemberBreakdownItem,
  MonthSummary,
  NetWorth,
  PendingSummary,
} from "@/shared/contracts/reports";
import {
  addMonths,
  fromCalendarDate,
  monthRange,
  toCalendarDate,
  todayIn,
  type CalendarDate,
  type DateRange,
} from "@/shared/dates";
import { convert, money } from "@/shared/money";

/**
 * Dashboard.
 *
 * Todas las agregaciones se hacen en SQL (`groupBy`), no trayendo filas a
 * memoria: es la pantalla que más se abre y un Space con años de movimientos
 * no entra en un `reduce`.
 *
 * Los totales se calculan sobre `amountPrimaryMinor` cuando existe —el importe
 * ya convertido y congelado al crear el movimiento— y sobre `amountMinor`
 * cuando la moneda coincide con la primaria. Nunca se convierte al vuelo con
 * la cotización de hoy: un reporte de enero tiene que dar lo mismo en marzo.
 */

const dto = (amountMinor: bigint, currency: string): MoneyDTO => ({
  amountMinor: amountMinor.toString(),
  currency,
});

/**
 * Suma de un período, separando ingresos de egresos.
 *
 * Las TRANSFERENCIAS quedan fuera: mover plata entre dos cuentas propias no es
 * ni ingreso ni gasto, y contarlas infla las dos columnas.
 */
const summarize = async (
  db: ScopedDb,
  range: DateRange,
  primaryCurrency: string,
): Promise<MonthSummary> => {
  // Suma correcta con monedas mezcladas: ver la nota en aggregate.ts.
  const rows = await groupSumInPrimary(db, ["type"], {
    date: {
      gte: fromCalendarDate(range.start),
      lte: fromCalendarDate(range.end),
    },
    type: { in: ["INCOME", "EXPENSE"] },
  });

  let incomeMinor = 0n;
  let expenseMinor = 0n;
  let count = 0;

  for (const row of rows) {
    if (row.key.type === "INCOME") incomeMinor += row.totalMinor;
    else if (row.key.type === "EXPENSE") expenseMinor += row.totalMinor;
    count += row.count;
  }

  return {
    from: range.start,
    to: range.end,
    income: dto(incomeMinor, primaryCurrency),
    expense: dto(expenseMinor, primaryCurrency),
    net: dto(incomeMinor - expenseMinor, primaryCurrency),
    transactionCount: count,
  };
};

/**
 * Patrimonio neto.
 *
 * Se devuelve desglosado por moneda ADEMÁS del total convertido. Convertir usa
 * la última cotización conocida, que es una estimación de hoy y no un dato
 * histórico congelado; si falta alguna, `converted` viene null y
 * `missingRates` dice cuáles. Es preferible decir "no puedo convertir esto" a
 * mostrar un número que parece exacto y no lo es.
 */
const computeNetWorth = async (
  db: ScopedDb,
  primaryCurrency: string,
  today: CalendarDate,
): Promise<NetWorth> => {
  // Solo las cuentas marcadas para el inicio: el total tiene que poder
  // explicarse sumando la lista que se ve justo debajo.
  const balances = await accountBalances(db, { onlyInNetWorth: true });

  const totals = new Map<string, bigint>();
  for (const balance of balances.values()) {
    totals.set(
      balance.currency,
      (totals.get(balance.currency) ?? 0n) + balance.balanceMinor,
    );
  }

  const byCurrency = [...totals.entries()]
    .map(([currency, amountMinor]) => dto(amountMinor, currency))
    .sort((a, b) =>
      a.currency === primaryCurrency
        ? -1
        : b.currency === primaryCurrency
          ? 1
          : a.currency.localeCompare(b.currency),
    );

  const provider = getRateProvider();
  const missingRates: string[] = [];
  let convertedTotal = 0n;

  for (const [currency, amountMinor] of totals) {
    if (currency === primaryCurrency) {
      convertedTotal += amountMinor;
      continue;
    }

    const rate = await provider.find(currency, primaryCurrency, today);
    if (rate === null) {
      missingRates.push(currency);
      continue;
    }

    const result = convert(
      money(amountMinor, currency),
      rate.rate,
      primaryCurrency,
    );
    if (!result.ok) {
      missingRates.push(currency);
      continue;
    }
    convertedTotal += result.value.amountMinor;
  }

  return {
    byCurrency,
    converted:
      missingRates.length === 0 ? dto(convertedTotal, primaryCurrency) : null,
    missingRates,
  };
};

const topExpenseCategories = async (
  db: ScopedDb,
  range: DateRange,
  primaryCurrency: string,
  limit: number,
): Promise<CategoryBreakdownItem[]> => {
  const grouped = await groupSumInPrimary(db, ["categoryId"], {
    type: "EXPENSE",
    date: {
      gte: fromCalendarDate(range.start),
      lte: fromCalendarDate(range.end),
    },
  });

  const totals = grouped.map((row) => ({
    categoryId: row.key.categoryId,
    totalMinor: row.totalMinor,
  }));

  const grandTotal = totals.reduce((sum, row) => sum + row.totalMinor, 0n);

  const ids = totals
    .map((row) => row.categoryId)
    .filter((id): id is string => id !== null);

  const categories =
    ids.length === 0
      ? []
      : await db.category.findMany({
          where: { id: { in: ids } },
          select: { id: true, name: true, color: true, icon: true },
        });
  const byId = new Map(categories.map((c) => [c.id, c]));

  return totals
    .sort((a, b) => (b.totalMinor > a.totalMinor ? 1 : -1))
    .slice(0, limit)
    .map((row) => {
      const category =
        row.categoryId === null ? null : byId.get(row.categoryId);
      return {
        categoryId: row.categoryId,
        name: category?.name ?? "Sin categoría",
        color: category?.color ?? null,
        icon: category?.icon ?? null,
        total: dto(row.totalMinor, primaryCurrency),
        percentage: percentageOf(row.totalMinor, grandTotal),
      };
    });
};

/**
 * Gasto por miembro. Solo tiene sentido en Spaces compartidos: en uno personal
 * sería una sola barra al 100%.
 */
const byMember = async (
  db: ScopedDb,
  range: DateRange,
  primaryCurrency: string,
): Promise<MemberBreakdownItem[]> => {
  const memberships = await db.membership.findMany({
    select: {
      userId: true,
      user: { select: { name: true, avatarUrl: true } },
    },
  });

  if (memberships.length <= 1) return [];

  const grouped = await groupSumInPrimary(db, ["createdByUserId"], {
    type: "EXPENSE",
    date: {
      gte: fromCalendarDate(range.start),
      lte: fromCalendarDate(range.end),
    },
  });

  const byId = new Map(memberships.map((m) => [m.userId, m.user]));

  return grouped
    .map((row) => {
      const userId = row.key.createdByUserId;
      const user = userId === null ? null : byId.get(userId);

      return {
        userId,
        // Quien ya no es miembro (o borró su cuenta) igual aparece: sus
        // movimientos siguen siendo del Space.
        name: user?.name ?? "Ex miembro",
        avatarUrl: user?.avatarUrl ?? null,
        total: dto(row.totalMinor, primaryCurrency),
        transactionCount: row.count,
      };
    })
    .sort((a, b) =>
      BigInt(b.total.amountMinor) > BigInt(a.total.amountMinor) ? 1 : -1,
    );
};

/**
 * Movimientos por confirmar: los que nacieron PENDING (reglas programadas sin
 * auto-confirmar, importaciones marcadas como pendientes).
 *
 * Se listan los más antiguos primero —lo que lleva más tiempo sin revisar es
 * lo primero que hay que mirar— y `count` trae el total real para que la
 * tarjeta pueda decir "y N más" sin traerlos todos.
 */
const PENDING_ITEMS_LIMIT = 5;

const pendingTransactions = async (db: ScopedDb): Promise<PendingSummary> => {
  // Sin transferencias: se crean CLEARED y además no se editan por pata.
  const where = {
    status: "PENDING" as const,
    type: { in: ["INCOME", "EXPENSE"] as ("INCOME" | "EXPENSE")[] },
  };

  const [count, rows] = await Promise.all([
    db.transaction.count({ where }),
    db.transaction.findMany({
      where,
      orderBy: [{ date: "asc" }, { createdAt: "asc" }],
      take: PENDING_ITEMS_LIMIT,
      select: {
        id: true,
        type: true,
        amountMinor: true,
        currency: true,
        date: true,
        description: true,
        account: { select: { name: true } },
        category: { select: { name: true, color: true } },
      },
    }),
  ]);

  return {
    count,
    items: rows.map((row) => ({
      id: row.id,
      type: row.type as "INCOME" | "EXPENSE",
      amount: dto(row.amountMinor, row.currency),
      date: toCalendarDate(row.date),
      description: row.description,
      categoryName: row.category?.name ?? null,
      categoryColor: row.category?.color ?? null,
      accountName: row.account.name,
    })),
  };
};

export const getDashboard = async (
  db: ScopedDb,
  space: { readonly primaryCurrency: string; readonly timezone: string },
  viewerTimezone: string,
  month?: CalendarDate,
): Promise<DashboardResponse> => {
  // "Hoy" en la timezone de quien mira, no la del servidor.
  const today = todayIn(viewerTimezone);
  const anchor = month ?? today;
  const current = monthRange(anchor);
  const previous = monthRange(addMonths(anchor, -1));

  const [
    summary,
    previousSummary,
    netWorth,
    accounts,
    topCategories,
    members,
    budgets,
    reminders,
    pending,
  ] = await Promise.all([
    summarize(db, current, space.primaryCurrency),
    summarize(db, previous, space.primaryCurrency),
    computeNetWorth(db, space.primaryCurrency, today),
    accountSummaries(db),
    topExpenseCategories(db, current, space.primaryCurrency, 6),
    byMember(db, current, space.primaryCurrency),
    budgetSummary(db, viewerTimezone, space.primaryCurrency),
    goalReminders(db, viewerTimezone),
    pendingTransactions(db),
  ]);

  return {
    primaryCurrency: space.primaryCurrency,
    month: summary,
    previousMonth: previousSummary,
    netWorth,
    accounts,
    topExpenseCategories: topCategories,
    byMember: members,
    budgets,
    goalReminders: reminders,
    pendingTransactions: pending,
  };
};

const accountSummaries = async (
  db: ScopedDb,
): Promise<AccountBalanceSummary[]> => {
  const rows = await db.account.findMany({
    where: { isArchived: false, includeInNetWorth: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      name: true,
      type: true,
      currency: true,
      color: true,
      icon: true,
      isArchived: true,
    },
  });

  const balances = await accountBalances(db);
  const reservations = await reservedByAccount(db, rows);

  return rows.map((row) => {
    const balance = balances.get(row.id);
    const balanceMinor = balance?.balanceMinor ?? 0n;
    const reservedMinor = reservations.get(row.id)?.reservedMinor ?? 0n;

    return {
      accountId: row.id,
      name: row.name,
      type: row.type,
      color: row.color,
      icon: row.icon,
      balance: dto(balanceMinor, row.currency),
      reserved: dto(reservedMinor, row.currency),
      available: dto(balanceMinor - reservedMinor, row.currency),
      isArchived: row.isArchived,
    };
  });
};
