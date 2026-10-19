import {
  balanceBefore,
  categoryTotals,
  dailyTotals,
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
  ComparisonTarget,
  MemberReport,
  SeriesPoint,
  SeriesReport,
} from "@/shared/contracts/reports-v2";
import {
  fromCalendarDate,
  minCalendarDate,
  monthRange,
  todayIn,
  type CalendarDate,
  type DateRange,
} from "@/shared/dates";
import {
  bucketKeyFor,
  bucketLabel,
  bucketsFor,
  bucketTitle,
  dayCount,
  granularityFor,
  lastMonthsRange,
  previousRange,
  sameRangeLastYear,
  type SeriesGranularity,
} from "@/shared/periods";

import { groupSumInPrimary } from "./aggregate";

/**
 * Reportes.
 *
 * Las series bajan a SQL crudo (`db/raw/reports.ts`) porque agrupar por mes o
 * por día necesita `date_trunc`/`to_char` y el `groupBy` de Prisma solo admite
 * columnas. El resto usa el cliente scopeado.
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

// ───────────────────── serie temporal + cash flow ────────────────────────────

export interface SeriesOptions {
  /**
   * `auto` elige según el largo del rango (ver `granularityFor`). Se puede
   * fijar, ya sea porque el usuario lo pidió o porque el consumidor necesita
   * una forma concreta: `monthlyReport` fija `month` para que "los últimos N
   * meses" sean siempre N puntos mensuales, incluso con N = 1.
   */
  readonly granularity?: SeriesGranularity | "auto";
  /** 0 = domingo … 6 = sábado. Solo importa en el corte semanal. */
  readonly weekStartsOn?: number;
  /**
   * Qué día es hoy para quien pregunta. Acota el promedio diario a los días
   * ya transcurridos: el 10 del mes, el gasto medio por día se divide por 10,
   * no por 31. Sin esto se asume que el rango entero ya pasó.
   */
  readonly today?: CalendarDate;
}

interface Totals {
  incomeMinor: bigint;
  expenseMinor: bigint;
  transferNetMinor: bigint;
  transactionCount: number;
  transferCount: number;
}

/**
 * Serie de ingresos, gastos y patrimonio acumulado sobre un rango.
 *
 * Los cortes SIN movimientos se rellenan con ceros. Si se omitieran, el
 * gráfico uniría diciembre con febrero como si fueran contiguos y la
 * pendiente mentiría.
 *
 * El acumulado arranca del patrimonio real anterior al rango, no de cero: si
 * no, la curva daría a entender que todo nació con el primer corte.
 */
export const seriesReport = async (
  space: SpaceContext,
  locale: string,
  range: DateRange,
  options: SeriesOptions = {},
): Promise<SeriesReport> => {
  const granularity =
    options.granularity === undefined || options.granularity === "auto"
      ? granularityFor(range)
      : options.granularity;
  const weekStartsOn = options.weekStartsOn ?? 1;

  const from = fromCalendarDate(range.start);
  const to = fromCalendarDate(range.end);

  const [rows, opening] = await Promise.all([
    granularity === "month"
      ? monthlyTotals(space.spaceId, from, to).then((list) =>
          list.map((row) => ({ key: row.month, ...row })),
        )
      : dailyTotals(space.spaceId, from, to).then((list) =>
          list.map((row) => ({
            key: bucketKeyFor(row.day, range, granularity, weekStartsOn),
            ...row,
          })),
        ),
    balanceBefore(space.spaceId, from),
  ]);

  // Por semana llegan varios días con la misma clave: se suman.
  const byKey = new Map<string, Totals>();
  for (const row of rows) {
    const current = byKey.get(row.key);
    byKey.set(row.key, {
      incomeMinor: (current?.incomeMinor ?? 0n) + row.incomeMinor,
      expenseMinor: (current?.expenseMinor ?? 0n) + row.expenseMinor,
      transferNetMinor:
        (current?.transferNetMinor ?? 0n) + row.transferNetMinor,
      transactionCount: (current?.transactionCount ?? 0) + row.transactionCount,
      transferCount: (current?.transferCount ?? 0) + row.transferCount,
    });
  }

  let running = opening;
  const points: SeriesPoint[] = [];

  for (const bucket of bucketsFor(range, granularity, weekStartsOn)) {
    const totals = byKey.get(bucket.key);
    const incomeMinor = totals?.incomeMinor ?? 0n;
    const expenseMinor = totals?.expenseMinor ?? 0n;
    // El neto de transferencias solo mueve el ACUMULADO, nunca las columnas:
    // para los pares reales es cero, y la pata suelta de un préstamo es caja
    // que se fue (o vino) sin ser gasto ni ingreso.
    running += incomeMinor - expenseMinor + (totals?.transferNetMinor ?? 0n);

    points.push({
      key: bucket.key,
      from: bucket.start,
      to: bucket.end,
      label: bucketLabel(bucket, granularity, locale),
      title: bucketTitle(bucket, granularity, locale),
      income: money(incomeMinor, space.primaryCurrency),
      expense: money(expenseMinor, space.primaryCurrency),
      net: money(incomeMinor - expenseMinor, space.primaryCurrency),
      runningBalance: money(running, space.primaryCurrency),
      transactionCount: totals?.transactionCount ?? 0,
      transferCount: totals?.transferCount ?? 0,
    });
  }

  const sum = (
    list: readonly SeriesPoint[],
    pick: (p: SeriesPoint) => MoneyDTO,
  ): bigint =>
    list.reduce((total, point) => total + BigInt(pick(point).amountMinor), 0n);

  /**
   * Sobre qué se promedia.
   *
   * Por semana y por mes, solo sobre los cortes CON actividad: incluir los
   * meses anteriores a que se empezara a usar la app hundiría el promedio y
   * daría una lectura falsa.
   *
   * Por día es al revés: los días sin gasto SON parte del promedio —gastar
   * 100 € en 10 días de 31 es gastar 32 € por día, no 100—, pero solo los que
   * ya pasaron: el 10 del mes se divide por 10, no por 31.
   */
  const active = points.filter((p) => p.transactionCount > 0);
  const elapsedDays =
    options.today === undefined
      ? dayCount(range)
      : options.today < range.start
        ? 0
        : dayCount({
            start: range.start,
            end: minCalendarDate(range.end, options.today),
          });
  const basis = granularity === "day" ? points : active;
  const divisor = BigInt(
    Math.max(granularity === "day" ? elapsedDays : active.length, 1),
  );

  const ranked = [...active].sort((a, b) =>
    Number(BigInt(b.net.amountMinor) - BigInt(a.net.amountMinor)),
  );

  const totalIncome = sum(points, (p) => p.income);
  const totalExpense = sum(points, (p) => p.expense);
  const currency = space.primaryCurrency;

  return {
    currency,
    granularity,
    from: range.start,
    to: range.end,
    points,
    totalIncome: money(totalIncome, currency),
    totalExpense: money(totalExpense, currency),
    totalNet: money(totalIncome - totalExpense, currency),
    averageIncome: money(sum(basis, (p) => p.income) / divisor, currency),
    averageExpense: money(sum(basis, (p) => p.expense) / divisor, currency),
    averageNet: money(sum(basis, (p) => p.net) / divisor, currency),
    best: ranked[0]?.key ?? null,
    worst: ranked.at(-1)?.key ?? null,
  };
};

/**
 * Los últimos N meses hasta el actual, siempre por mes.
 *
 * Es la forma original de la serie y la que usan los tests de otros módulos
 * para verificar que una transferencia, un aporte a una meta o un préstamo
 * no se cuelan en el gasto del mes.
 */
export const monthlyReport = (
  space: SpaceContext,
  locale: string,
  viewerTimezone: string,
  months: number,
): Promise<SeriesReport> => {
  const today = todayIn(viewerTimezone);
  return seriesReport(space, locale, lastMonthsRange(today, months), {
    granularity: "month",
    today,
  });
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

// ──────────────────────────── comparativa ────────────────────────────────────

/**
 * Un período contra otro, categoría por categoría.
 *
 * Contra qué lo dice `against`: el inmediatamente anterior del mismo largo
 * (`previousRange`, la misma regla que usan las flechas del selector, así lo
 * que se compara es lo que se vería al retroceder) o el mismo período del año
 * pasado (`sameRangeLastYear`), que es lo que muestra la estacionalidad.
 *
 * Ordenado por variación ABSOLUTA: lo primero que uno quiere ver es qué
 * cambió más, sin importar si subió o bajó.
 */
export const comparisonReport = async (
  space: SpaceContext,
  current: DateRange,
  kind: "INCOME" | "EXPENSE",
  against: ComparisonTarget = "previous",
): Promise<ComparisonReport> => {
  const previous =
    against === "year" ? sameRangeLastYear(current) : previousRange(current);

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

  // Categorías con movimientos en el período anterior y nada en este. Se
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
    against,
    current: { from: current.start, to: current.end },
    previous: { from: previous.start, to: previous.end },
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
export const defaultRange = (viewerTimezone: string): DateRange =>
  monthRange(todayIn(viewerTimezone));
