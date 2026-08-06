import {
  balanceBefore,
  categoryTotals,
  monthlyTotals,
} from "@/server/db/raw/reports";
import type { ScopedDb } from "@/server/db/scoped";
import { percentageOf } from "@/shared/balance";
import type { MoneyDTO } from "@/shared/contracts/common";
import type {
  CategoryReport,
  CategoryReportItem,
  ComparisonItem,
  ComparisonReport,
  MemberReport,
  MonthlyPoint,
  MonthlyReport,
} from "@/shared/contracts/reports-v2";
import {
  addMonths,
  endOfMonth,
  formatCalendarDate,
  fromCalendarDate,
  monthRange,
  startOfMonth,
  todayIn,
  type CalendarDate,
} from "@/shared/dates";

import { groupSumInPrimary } from "./aggregate";

/**
 * Reportes.
 *
 * Las series por mes bajan a SQL crudo (`db/raw/reports.ts`) porque agrupar
 * por mes necesita `date_trunc` y el `groupBy` de Prisma solo admite columnas.
 * El resto usa el cliente scopeado.
 *
 * Todos los importes salen ya en la moneda primaria del Space: los reportes
 * históricos usan la conversión CONGELADA al cargar cada movimiento, nunca la
 * cotización de hoy. Un reporte de enero tiene que dar lo mismo en marzo.
 */

const money = (amountMinor: bigint, currency: string): MoneyDTO => ({
  amountMinor: amountMinor.toString(),
  currency,
});

interface SpaceContext {
  readonly spaceId: string;
  readonly primaryCurrency: string;
}

// ─────────────────── evolución mensual + cash flow ───────────────────────────

/**
 * Serie mensual con el patrimonio acumulado.
 *
 * Los meses SIN movimientos se rellenan con ceros. Si se omitieran, el gráfico
 * uniría diciembre con febrero como si fueran contiguos y la pendiente
 * mentiría.
 *
 * El acumulado arranca del patrimonio real anterior al rango, no de cero: si
 * no, la curva daría a entender que todo nació con el primer mes del gráfico.
 */
export const monthlyReport = async (
  space: SpaceContext,
  locale: string,
  viewerTimezone: string,
  months: number,
): Promise<MonthlyReport> => {
  const today = todayIn(viewerTimezone);
  const lastMonth = startOfMonth(today);
  const firstMonth = addMonths(lastMonth, -(months - 1));

  const [rows, opening] = await Promise.all([
    monthlyTotals(
      space.spaceId,
      fromCalendarDate(firstMonth),
      fromCalendarDate(endOfMonth(lastMonth)),
    ),
    balanceBefore(space.spaceId, fromCalendarDate(firstMonth)),
  ]);

  const byMonth = new Map(rows.map((row) => [row.month, row]));

  let running = opening;
  const points: MonthlyPoint[] = [];

  for (let offset = 0; offset < months; offset += 1) {
    const anchor = addMonths(firstMonth, offset);
    const key = anchor.slice(0, 7);
    const row = byMonth.get(key);

    const incomeMinor = row?.incomeMinor ?? 0n;
    const expenseMinor = row?.expenseMinor ?? 0n;
    running += incomeMinor - expenseMinor;

    points.push({
      month: key,
      label: formatCalendarDate(anchor, locale, {
        month: "short",
        year: "2-digit",
      }),
      income: money(incomeMinor, space.primaryCurrency),
      expense: money(expenseMinor, space.primaryCurrency),
      net: money(incomeMinor - expenseMinor, space.primaryCurrency),
      runningBalance: money(running, space.primaryCurrency),
      transactionCount: row?.transactionCount ?? 0,
    });
  }

  /**
   * Los promedios se calculan solo sobre los meses CON actividad. Incluir los
   * vacíos —los anteriores a que se empezara a usar la app— hundiría el
   * promedio y daría una lectura falsa.
   */
  const active = points.filter((p) => p.transactionCount > 0);
  const divisor = BigInt(Math.max(active.length, 1));

  const sum = (pick: (p: MonthlyPoint) => MoneyDTO): bigint =>
    active.reduce(
      (total, point) => total + BigInt(pick(point).amountMinor),
      0n,
    );

  const ranked = [...active].sort((a, b) =>
    Number(BigInt(b.net.amountMinor) - BigInt(a.net.amountMinor)),
  );

  return {
    currency: space.primaryCurrency,
    points,
    averageIncome: money(sum((p) => p.income) / divisor, space.primaryCurrency),
    averageExpense: money(
      sum((p) => p.expense) / divisor,
      space.primaryCurrency,
    ),
    averageNet: money(sum((p) => p.net) / divisor, space.primaryCurrency),
    bestMonth: ranked[0]?.month ?? null,
    worstMonth: ranked.at(-1)?.month ?? null,
  };
};

// ───────────────────────── desglose por categoría ────────────────────────────

/**
 * Desglose por categoría, anidando las subcategorías bajo su padre.
 *
 * Se agrupa por padre porque es la lectura útil: "cuánto me fui en comida", no
 * "cuánto en supermercado, cuánto en restaurantes y cuánto en cafetería". El
 * detalle queda disponible en `children` para desplegar.
 */
export const categoryReport = async (
  db: ScopedDb,
  space: SpaceContext,
  from: CalendarDate,
  to: CalendarDate,
  kind: "INCOME" | "EXPENSE",
): Promise<CategoryReport> => {
  const rows = await categoryTotals(
    space.spaceId,
    fromCalendarDate(from),
    fromCalendarDate(to),
    kind,
  );

  const total = rows.reduce((sum, row) => sum + row.totalMinor, 0n);

  // Las hijas se acumulan bajo su padre; las que no tienen padre son raíz.
  interface Node {
    row: (typeof rows)[number];
    totalMinor: bigint;
    count: number;
    children: (typeof rows)[number][];
  }

  const roots = new Map<string, Node>();
  const orphans: (typeof rows)[number][] = [];

  for (const row of rows) {
    if (row.parentId === null) {
      const existing = roots.get(row.categoryId ?? "none");
      roots.set(row.categoryId ?? "none", {
        row,
        totalMinor: (existing?.totalMinor ?? 0n) + row.totalMinor,
        count: (existing?.count ?? 0) + row.transactionCount,
        children: existing?.children ?? [],
      });
    } else {
      orphans.push(row);
    }
  }

  for (const child of orphans) {
    const parent = roots.get(child.parentId ?? "");

    if (parent === undefined) {
      /**
       * El padre no tiene movimientos propios en el rango, así que no vino en
       * la consulta. Se crea el nodo con los datos de la hija como semilla y
       * se corrige el nombre después: sin esto, el gasto de la subcategoría
       * desaparecería del reporte.
       */
      roots.set(child.parentId ?? "", {
        row: { ...child, categoryId: child.parentId, name: "", parentId: null },
        totalMinor: child.totalMinor,
        count: child.transactionCount,
        children: [child],
      });
      continue;
    }

    roots.set(child.parentId ?? "", {
      ...parent,
      totalMinor: parent.totalMinor + child.totalMinor,
      count: parent.count + child.transactionCount,
      children: [...parent.children, child],
    });
  }

  // Nombres de los padres que solo aparecieron a través de sus hijas.
  const missing = [...roots.values()]
    .filter((node) => node.row.name === "")
    .map((node) => node.row.categoryId)
    .filter((id): id is string => id !== null);

  const names = new Map<
    string,
    { name: string; color: string | null; icon: string | null }
  >();
  if (missing.length > 0) {
    const found = await db.category.findMany({
      where: { id: { in: missing } },
      select: { id: true, name: true, color: true, icon: true },
    });
    for (const entry of found) names.set(entry.id, entry);
  }

  const items: CategoryReportItem[] = [...roots.values()]
    .map((node) => {
      const resolved =
        node.row.name === "" && node.row.categoryId !== null
          ? names.get(node.row.categoryId)
          : undefined;

      return {
        categoryId: node.row.categoryId,
        name: resolved?.name ?? node.row.name,
        color: resolved?.color ?? node.row.color,
        icon: resolved?.icon ?? node.row.icon,
        total: money(node.totalMinor, space.primaryCurrency),
        percentage: percentageOf(node.totalMinor, total),
        transactionCount: node.count,
        children: node.children
          .map((child) => ({
            categoryId: child.categoryId,
            name: child.name,
            color: child.color,
            icon: child.icon,
            total: money(child.totalMinor, space.primaryCurrency),
            percentage: percentageOf(child.totalMinor, node.totalMinor),
            transactionCount: child.transactionCount,
          }))
          .sort((a, b) =>
            BigInt(b.total.amountMinor) > BigInt(a.total.amountMinor) ? 1 : -1,
          ),
      };
    })
    .sort((a, b) =>
      BigInt(b.total.amountMinor) > BigInt(a.total.amountMinor) ? 1 : -1,
    );

  return {
    currency: space.primaryCurrency,
    from,
    to,
    total: money(total, space.primaryCurrency),
    items,
  };
};

// ────────────────────────── comparativa mes a mes ────────────────────────────

/**
 * Mes contra mes, categoría por categoría.
 *
 * Ordenado por variación ABSOLUTA: lo primero que uno quiere ver es qué
 * cambió más, sin importar si subió o bajó.
 */
export const comparisonReport = async (
  space: SpaceContext,
  month: CalendarDate,
  kind: "INCOME" | "EXPENSE",
): Promise<ComparisonReport> => {
  const current = monthRange(month);
  const previous = monthRange(addMonths(month, -1));

  const [currentRows, previousRows] = await Promise.all([
    categoryTotals(
      space.spaceId,
      fromCalendarDate(current.start),
      fromCalendarDate(current.end),
      kind,
    ),
    categoryTotals(
      space.spaceId,
      fromCalendarDate(previous.start),
      fromCalendarDate(previous.end),
      kind,
    ),
  ]);

  const previousByCategory = new Map(
    previousRows.map((row) => [row.categoryId ?? "none", row.totalMinor]),
  );

  const seen = new Set<string>();
  const items: ComparisonItem[] = [];

  for (const row of currentRows) {
    const key = row.categoryId ?? "none";
    seen.add(key);
    const previousTotal = previousByCategory.get(key) ?? 0n;

    items.push(buildItem(row, previousTotal, space.primaryCurrency));
  }

  // Categorías que existían el mes pasado y este mes no tienen nada. Se
  // incluyen: "dejaste de gastar en esto" es información, no ausencia de ella.
  for (const row of previousRows) {
    const key = row.categoryId ?? "none";
    if (seen.has(key)) continue;

    items.push(
      buildItem(
        { ...row, totalMinor: 0n },
        row.totalMinor,
        space.primaryCurrency,
      ),
    );
  }

  items.sort((a, b) => {
    const abs = (value: string): bigint => {
      const n = BigInt(value);
      return n < 0n ? -n : n;
    };
    return abs(b.delta.amountMinor) > abs(a.delta.amountMinor) ? 1 : -1;
  });

  const currentTotal = currentRows.reduce(
    (sum, row) => sum + row.totalMinor,
    0n,
  );
  const previousTotal = previousRows.reduce(
    (sum, row) => sum + row.totalMinor,
    0n,
  );

  return {
    currency: space.primaryCurrency,
    currentMonth: current.start.slice(0, 7),
    previousMonth: previous.start.slice(0, 7),
    currentTotal: money(currentTotal, space.primaryCurrency),
    previousTotal: money(previousTotal, space.primaryCurrency),
    delta: money(currentTotal - previousTotal, space.primaryCurrency),
    deltaPercentage: variation(currentTotal, previousTotal),
    items,
  };
};

const buildItem = (
  row: {
    categoryId: string | null;
    name: string;
    color: string | null;
    icon: string | null;
    totalMinor: bigint;
  },
  previousMinor: bigint,
  currency: string,
): ComparisonItem => ({
  categoryId: row.categoryId,
  name: row.name,
  color: row.color,
  icon: row.icon,
  current: money(row.totalMinor, currency),
  previous: money(previousMinor, currency),
  delta: money(row.totalMinor - previousMinor, currency),
  deltaPercentage: variation(row.totalMinor, previousMinor),
  isNew: previousMinor === 0n && row.totalMinor > 0n,
});

/**
 * Variación porcentual con un decimal.
 *
 * Devuelve `null` si la base es cero: dividir por cero no da "infinito por
 * ciento", da "no comparable". Mostrar "+∞%" o un número enorme sería peor que
 * no mostrar nada.
 */
const variation = (current: bigint, previous: bigint): number | null => {
  if (previous === 0n) return null;
  const abs = (value: bigint): bigint => (value < 0n ? -value : value);
  const delta = current - previous;
  const sign = delta < 0n ? -1 : 1;
  return (sign * Number((abs(delta) * 1000n) / abs(previous))) / 10;
};

// ───────────────────────── desglose por miembro ──────────────────────────────

/**
 * Gasto por miembro en un rango.
 *
 * Tiene sentido solo en Spaces compartidos; en uno personal sería una sola
 * barra al 100%. El endpoint lo devuelve igual y la UI decide si mostrarlo.
 */
export const memberReport = async (
  db: ScopedDb,
  space: SpaceContext,
  from: CalendarDate,
  to: CalendarDate,
  kind: "INCOME" | "EXPENSE",
): Promise<MemberReport> => {
  const [grouped, memberships] = await Promise.all([
    groupSumInPrimary(db, ["createdByUserId"], {
      type: kind,
      date: { gte: fromCalendarDate(from), lte: fromCalendarDate(to) },
    }),
    db.membership.findMany({
      select: {
        userId: true,
        user: { select: { name: true, avatarUrl: true } },
      },
    }),
  ]);

  const byId = new Map(memberships.map((m) => [m.userId, m.user]));
  const total = grouped.reduce((sum, row) => sum + row.totalMinor, 0n);

  const items = grouped
    .map((row) => {
      const userId = row.key.createdByUserId;
      const user = userId === null ? null : byId.get(userId);

      return {
        userId,
        // Quien ya no es miembro igual aparece: sus movimientos siguen siendo
        // del Space y sacarlos descuadraría el total.
        name: user?.name ?? "Ex miembro",
        avatarUrl: user?.avatarUrl ?? null,
        total: money(row.totalMinor, space.primaryCurrency),
        percentage: percentageOf(row.totalMinor, total),
        transactionCount: row.count,
      };
    })
    .sort((a, b) =>
      BigInt(b.total.amountMinor) > BigInt(a.total.amountMinor) ? 1 : -1,
    );

  return {
    currency: space.primaryCurrency,
    from,
    to,
    total: money(total, space.primaryCurrency),
    items,
  };
};

/** Rango por defecto de los reportes con rango: el mes en curso. */
export const defaultRange = (
  viewerTimezone: string,
): { from: CalendarDate; to: CalendarDate } => {
  const range = monthRange(todayIn(viewerTimezone));
  return { from: range.start, to: range.end };
};
