"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import {
  ArrowUpRight,
  ChevronDown,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";

import { PeriodPicker } from "@/components/reports/period-picker";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card } from "@/components/ui/card";
import { DynamicIcon } from "@/components/ui/dynamic-icon";
import { SegmentedToggle } from "@/components/ui/segmented-toggle";
import { Skeleton } from "@/components/ui/skeleton";
import { api, qs } from "@/lib/api-client";
import { formatMoneyDTO, formatPercent, initials } from "@/lib/format";
import { useActiveSpace, useSession } from "@/lib/hooks/use-session";
import { spaceScopeKey } from "@/lib/query-keys";
import { cn } from "@/lib/utils";
import type { BudgetWithStatus } from "@/shared/contracts/budgets";
import type {
  CategoryReport,
  ComparisonReport,
  ComparisonTarget,
  MemberReport,
  SeriesGranularity,
  SeriesPoint,
  SeriesReport,
} from "@/shared/contracts/reports-v2";
import {
  isCalendarDate,
  monthRange,
  todayIn,
  type DateRange,
} from "@/shared/dates";
import {
  allowedGranularities,
  describeRange,
  exceedsMaxRange,
  isOrderedRange,
} from "@/shared/periods";

/** Recharts pesa >100 kB y solo hace falta en esta pantalla. */
const SeriesChart = dynamic(
  () => import("@/components/charts/series-chart").then((m) => m.SeriesChart),
  {
    ssr: false,
    loading: () => <Skeleton className="h-48 w-full rounded-xl" />,
  },
);
const SeriesTable = dynamic(
  () => import("@/components/charts/series-chart").then((m) => m.SeriesTable),
  {
    ssr: false,
    loading: () => <Skeleton className="h-32 w-full rounded-xl" />,
  },
);
const CategoryDonut = dynamic(
  () =>
    import("@/components/charts/category-donut").then((m) => m.CategoryDonut),
  {
    ssr: false,
    loading: () => <Skeleton className="h-44 w-full rounded-xl" />,
  },
);

const TABS = [
  { id: "evolution", label: "Evolución" },
  { id: "categories", label: "Categorías" },
  { id: "comparison", label: "Comparar" },
  { id: "members", label: "Miembros" },
] as const;

type Tab = (typeof TABS)[number]["id"];
type Kind = "EXPENSE" | "INCOME";

const isTab = (value: string | null): value is Tab =>
  TABS.some((t) => t.id === value);

const GRANULARITY_UNIT: Record<SeriesGranularity, string> = {
  day: "día",
  week: "semana",
  month: "mes",
};

const GRANULARITY_LABEL: Record<SeriesGranularity, string> = {
  day: "Día",
  week: "Semana",
  month: "Mes",
};

const KIND_OPTIONS = [
  { value: "EXPENSE", label: "Gastos" },
  { value: "INCOME", label: "Ingresos" },
] as const;

/**
 * El período que pide la URL, si es válido. Uno inválido se ignora en vez de
 * romper la pantalla: la URL la puede haber escrito cualquiera.
 */
const rangeFromParams = (params: URLSearchParams): DateRange | null => {
  const from = params.get("from");
  const to = params.get("to");
  if (
    from === null ||
    to === null ||
    !isCalendarDate(from) ||
    !isCalendarDate(to)
  ) {
    return null;
  }
  const range = { start: from, end: to };
  return isOrderedRange(range) && !exceedsMaxRange(range) ? range : null;
};

/** Link a Movimientos ya filtrado: es el "ver de dónde sale este número". */
const transactionsHref = (filters: {
  range: DateRange;
  kind: Kind;
  categoryIds?: readonly string[];
  userId?: string;
}): string =>
  `/transactions${qs({
    from: filters.range.start,
    to: filters.range.end,
    type: filters.kind,
    categoryId:
      filters.categoryIds === undefined ? [] : [...filters.categoryIds],
    createdByUserId: filters.userId,
  })}`;

/**
 * `useSearchParams` exige un límite de Suspense para el prerender estático;
 * sin él, el build de Next falla en esta ruta.
 */
export default function ReportsPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ReportsScreen />
    </Suspense>
  );
}

/**
 * Reportes.
 *
 * Un período para toda la pantalla y pestañas debajo: cambiar de pestaña
 * cambia la pregunta, no de qué período se habla. Cada pestaña pide lo suyo
 * cuando se abre —cada reporte es una consulta pesada y cargarlas todas
 * juntas haría esperar por datos que quizá nadie mire— y, al cambiar el
 * período, sigue mostrando lo anterior atenuado hasta que llega lo nuevo.
 *
 * El período y la pestaña viven en la URL (`?tab=&from=&to=`): sobreviven a
 * recargar y a "atrás", y el dashboard puede linkear a un mes concreto. Se
 * escriben con `replaceState` y no con `push`: cada flecha no es una página
 * nueva a la que volver.
 */
function ReportsScreen() {
  const session = useSession();
  const { space } = useActiveSpace();
  const spaceId = space?.id ?? "";
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const timezone = session.data?.timezone;
  const today = useMemo(
    () => (timezone === undefined ? null : todayIn(timezone)),
    [timezone],
  );

  const tabParam = searchParams.get("tab");
  const tab: Tab = isTab(tabParam) ? tabParam : "evolution";
  const picked = useMemo(() => rangeFromParams(searchParams), [searchParams]);

  const navigate = (next: { tab?: Tab; range?: DateRange }) => {
    const params = new URLSearchParams(searchParams.toString());
    const nextTab = next.tab ?? tab;
    if (nextTab === "evolution") params.delete("tab");
    else params.set("tab", nextTab);
    if (next.range !== undefined) {
      params.set("from", next.range.start);
      params.set("to", next.range.end);
    }
    const query = params.toString();
    window.history.replaceState(
      null,
      "",
      query === "" ? pathname : `${pathname}?${query}`,
    );
  };

  if (session.data === undefined || today === null) return <PageSkeleton />;

  const { locale, weekStartsOn } = session.data;
  // Hasta que se elige otra cosa, el mes en curso en la timezone de quien
  // mira: a las 00:30 en Madrid el servidor en UTC diría que todavía es ayer.
  const range = picked ?? monthRange(today);

  const isShared = (space?.memberCount ?? 1) > 1;
  const visible = TABS.filter((t) => t.id !== "members" || isShared);

  return (
    <div className="space-y-4 py-3">
      <h1 className="text-xl font-semibold">Reportes</h1>

      <PeriodPicker
        range={range}
        today={today}
        locale={locale}
        weekStartsOn={weekStartsOn}
        onChange={(next) => {
          navigate({ range: next });
        }}
      />

      {/* Pestañas con scroll horizontal: a 375px no entran cuatro fijas. */}
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        {visible.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => {
              navigate({ tab: item.id });
            }}
            aria-pressed={tab === item.id}
            className={cn(
              "min-h-touch shrink-0 rounded-full border px-4 text-sm",
              tab === item.id &&
                "border-primary bg-primary text-primary-foreground",
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === "evolution" && (
        <Evolution spaceId={spaceId} locale={locale} range={range} />
      )}
      {tab === "categories" && (
        <Categories spaceId={spaceId} locale={locale} range={range} />
      )}
      {tab === "comparison" && (
        <Comparison spaceId={spaceId} locale={locale} range={range} />
      )}
      {tab === "members" && (
        <Members spaceId={spaceId} locale={locale} range={range} />
      )}
    </div>
  );
}

// ───────────────────────────── evolución ─────────────────────────────────────

function Evolution({
  spaceId,
  locale,
  range,
}: {
  spaceId: string;
  locale: string;
  range: DateRange;
}) {
  const [mode, setMode] = useState<"flow" | "balance">("flow");

  // La selección y el corte elegido van atados al período: al cambiarlo, lo
  // anterior ya no significa nada y se descarta sin necesidad de un efecto.
  const rangeId = `${range.start}:${range.end}`;
  const [selection, setSelection] = useState<{
    rangeId: string;
    key: string | null;
    granularity: SeriesGranularity | "auto";
  }>({ rangeId, key: null, granularity: "auto" });
  const current =
    selection.rangeId === rangeId
      ? selection
      : { rangeId, key: null, granularity: "auto" as const };
  const select = (key: string) => {
    setSelection({ ...current, key });
  };

  const report = useQuery({
    queryKey: [
      ...spaceScopeKey(spaceId),
      "reports",
      "series",
      range.start,
      range.end,
      current.granularity,
    ],
    queryFn: () =>
      api.get<SeriesReport>(
        `/spaces/${spaceId}/reports/monthly${qs({
          from: range.start,
          to: range.end,
          granularity:
            current.granularity === "auto" ? undefined : current.granularity,
        })}`,
      ),
    enabled: spaceId !== "",
    placeholderData: keepPreviousData,
  });

  if (report.data === undefined) return <ReportSkeleton />;

  const { points, granularity } = report.data;
  const byKey = new Map(points.map((p) => [p.key, p]));
  const unit = GRANULARITY_UNIT[granularity];

  // Lo que se detalla arriba del gráfico: lo tocado o, si no, el último corte
  // con actividad. Así la tarjeta nunca arranca vacía.
  const focus =
    byKey.get(current.key ?? "") ??
    [...points]
      .reverse()
      .find((p) => p.transactionCount > 0 || p.transferCount > 0) ??
    points.at(-1);
  const hasActivity = points.some((p) => p.transactionCount > 0);
  const netIsNegative = BigInt(report.data.totalNet.amountMinor) < 0n;

  const best =
    report.data.best === null ? undefined : byKey.get(report.data.best);
  const worst =
    report.data.worst === null ? undefined : byKey.get(report.data.worst);

  const granularityOptions = allowedGranularities(range).map((value) => ({
    value,
    label: GRANULARITY_LABEL[value],
  }));

  return (
    <div className={cn("space-y-4", report.isPlaceholderData && "opacity-60")}>
      <SegmentedToggle
        label="Qué mostrar"
        value={mode}
        options={[
          { value: "flow", label: "Ingresos y gastos" },
          { value: "balance", label: "Patrimonio" },
        ]}
        onChange={setMode}
      />

      <Card className="gap-3 p-4">
        <div className="flex items-center justify-between gap-2">
          {focus !== undefined ? (
            <Readout point={focus} mode={mode} locale={locale} />
          ) : (
            <span />
          )}
        </div>
        <SeriesChart
          points={points}
          mode={mode}
          title={`${mode === "flow" ? "Ingresos y gastos" : "Patrimonio"} por ${unit}, ${describeRange(range, locale)}`}
          selectedKey={focus?.key ?? null}
          onSelect={select}
        />
        {granularityOptions.length > 1 && (
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">Ver por</span>
            <SegmentedToggle
              size="sm"
              label="Corte de la serie"
              className="w-auto"
              value={granularity}
              options={granularityOptions}
              onChange={(value) => {
                setSelection({ ...current, key: null, granularity: value });
              }}
            />
          </div>
        )}
      </Card>

      <div className="grid grid-cols-3 gap-2">
        <Stat
          label="Ingresos"
          value={formatMoneyDTO(report.data.totalIncome, locale)}
          tone="income"
        />
        <Stat
          label="Gastos"
          value={formatMoneyDTO(report.data.totalExpense, locale)}
          tone="expense"
        />
        <Stat
          label="Resultado"
          value={formatMoneyDTO(report.data.totalNet, locale, {
            signDisplay: "always",
          })}
          tone={netIsNegative ? "expense" : "income"}
        />
      </div>

      {hasActivity && (
        <p className="px-1 text-xs text-muted-foreground tabular-nums">
          Promedio por {unit}:{" "}
          <span className="text-income">
            {formatMoneyDTO(report.data.averageIncome, locale)}
          </span>{" "}
          de ingresos ·{" "}
          <span className="text-expense">
            {formatMoneyDTO(report.data.averageExpense, locale)}
          </span>{" "}
          de gastos
        </p>
      )}

      {best !== undefined && worst !== undefined && best.key !== worst.key && (
        <div className="grid grid-cols-2 gap-2">
          <Highlight
            label={`Mejor ${unit}`}
            point={best}
            locale={locale}
            tone="income"
            onSelect={select}
          />
          <Highlight
            label={`Peor ${unit}`}
            point={worst}
            locale={locale}
            tone="expense"
            onSelect={select}
          />
        </div>
      )}

      <Card className="p-3">
        <SeriesTable
          points={points}
          locale={locale}
          mode={mode}
          selectedKey={focus?.key ?? null}
          onSelect={select}
        />
      </Card>
    </div>
  );
}

/** El detalle del corte elegido, siempre en el mismo lugar: arriba del gráfico. */
function Readout({
  point,
  mode,
  locale,
}: {
  point: SeriesPoint;
  mode: "flow" | "balance";
  locale: string;
}) {
  return (
    <div className="flex min-w-0 flex-1 items-baseline justify-between gap-3">
      <span className="min-w-0 truncate text-xs text-muted-foreground">
        {point.title}
      </span>

      {mode === "flow" ? (
        <span className="flex shrink-0 items-baseline gap-2 text-xs tabular-nums">
          <span className="text-income">
            {formatMoneyDTO(point.income, locale)}
          </span>
          <span className="text-expense">
            {formatMoneyDTO(point.expense, locale)}
          </span>
          <span
            className={cn(
              "text-sm font-semibold",
              BigInt(point.net.amountMinor) < 0n && "text-expense",
            )}
          >
            {formatMoneyDTO(point.net, locale, { signDisplay: "always" })}
          </span>
        </span>
      ) : (
        <span className="shrink-0 text-sm font-semibold tabular-nums">
          {formatMoneyDTO(point.runningBalance, locale)}
        </span>
      )}
    </div>
  );
}

/** Mejor o peor corte por resultado. Tocarlo lo elige en el gráfico. */
function Highlight({
  label,
  point,
  locale,
  tone,
  onSelect,
}: {
  label: string;
  point: SeriesPoint;
  locale: string;
  tone: "income" | "expense";
  onSelect: (key: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => {
        onSelect(point.key);
      }}
      className="flex flex-col gap-0.5 rounded-xl border bg-card p-3 text-left shadow-sm"
    >
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span className="truncate text-xs">{point.title}</span>
      <span
        className={cn(
          "text-sm font-semibold tabular-nums",
          tone === "income" ? "text-income" : "text-expense",
        )}
      >
        {formatMoneyDTO(point.net, locale, { signDisplay: "always" })}
      </span>
    </button>
  );
}

// ─────────────────────────── por categoría ───────────────────────────────────

const BUDGET_TONE: Record<BudgetWithStatus["state"], string> = {
  OK: "text-muted-foreground",
  WARNING: "text-amber-600 dark:text-amber-400",
  OVER: "text-expense",
};

function Categories({
  spaceId,
  locale,
  range,
}: {
  spaceId: string;
  locale: string;
  range: DateRange;
}) {
  const [kind, setKind] = useState<Kind>("EXPENSE");
  const [expanded, setExpanded] = useState<string | null>(null);

  const report = useQuery({
    queryKey: [
      ...spaceScopeKey(spaceId),
      "reports",
      "categories",
      kind,
      range.start,
      range.end,
    ],
    queryFn: () =>
      api.get<CategoryReport>(
        `/spaces/${spaceId}/reports/categories${qs({
          kind,
          from: range.start,
          to: range.end,
        })}`,
      ),
    enabled: spaceId !== "",
    placeholderData: keepPreviousData,
  });

  /**
   * Presupuestos cuyo período es exactamente el que se mira: un mensual en
   * un mes, uno fijo en su rango. La clave arranca igual que la de la
   * pantalla de presupuestos para que crear o editar uno la invalide también.
   */
  const budgets = useQuery({
    queryKey: [...spaceScopeKey(spaceId), "budgets", { asOf: range.start }],
    queryFn: () =>
      api.get<{ budgets: BudgetWithStatus[] }>(
        `/spaces/${spaceId}/budgets${qs({ asOf: range.start })}`,
      ),
    enabled: spaceId !== "" && kind === "EXPENSE",
    select: (data) =>
      data.budgets.filter(
        (b) => b.periodStart === range.start && b.periodEnd === range.end,
      ),
  });

  if (report.data === undefined) return <ReportSkeleton />;

  const items = report.data.items;
  const budgetByCategory = new Map(
    (budgets.data ?? []).flatMap((b) =>
      b.category === null ? [] : [[b.category.id, b] as const],
    ),
  );
  const globalBudget = (budgets.data ?? []).find((b) => b.category === null);

  return (
    <div className={cn("space-y-4", report.isPlaceholderData && "opacity-60")}>
      <SegmentedToggle
        label="Tipo de movimiento"
        value={kind}
        options={KIND_OPTIONS}
        onChange={setKind}
      />

      {items.length === 0 ? (
        <Empty range={range} locale={locale} />
      ) : (
        <>
          <Card className="gap-2 p-4">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-xs text-muted-foreground">
                {kind === "EXPENSE" ? "Total gastado" : "Total ingresado"} ·{" "}
                {describeRange(range, locale)}
              </span>
              <span className="text-lg font-semibold tabular-nums">
                {formatMoneyDTO(report.data.total, locale)}
              </span>
            </div>
            {globalBudget !== undefined && (
              <BudgetLine budget={globalBudget} locale={locale} />
            )}
            <CategoryDonut
              data={items.map((item) => ({
                categoryId: item.categoryId,
                name: item.name,
                color: item.color,
                icon: item.icon,
                total: item.total,
                percentage: item.percentage,
              }))}
              locale={locale}
              legend={false}
            />
          </Card>

          <Card className="divide-y p-0">
            {items.map((item) => {
              const color = item.color ?? "#71717a";
              const isOpen = expanded === item.categoryId;
              const budget =
                item.categoryId === null
                  ? undefined
                  : budgetByCategory.get(item.categoryId);
              // El total del padre incluye a las hijas: el link también.
              const ids = [
                item.categoryId,
                ...item.children.map((child) => child.categoryId),
              ].filter((id): id is string => id !== null);

              return (
                <div key={item.categoryId ?? "none"}>
                  <div className="flex items-center">
                    <button
                      type="button"
                      disabled={item.children.length === 0}
                      onClick={() => {
                        setExpanded(isOpen ? null : item.categoryId);
                      }}
                      className="flex min-h-touch min-w-0 flex-1 items-center gap-3 py-3 pl-4 text-left"
                    >
                      <span
                        className="flex size-8 shrink-0 items-center justify-center rounded-full"
                        style={{ backgroundColor: `${color}26` }}
                      >
                        <DynamicIcon
                          name={item.icon}
                          className="size-4"
                          style={{ color }}
                        />
                      </span>

                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline justify-between gap-2">
                          <span className="truncate text-sm font-medium">
                            {item.name}
                          </span>
                          <span className="shrink-0 text-sm font-medium tabular-nums">
                            {formatMoneyDTO(item.total, locale)}
                          </span>
                        </span>
                        <span className="mt-1 flex items-center gap-2">
                          <span className="h-1 flex-1 overflow-hidden rounded-full bg-secondary">
                            <span
                              className="block h-full rounded-full"
                              style={{
                                width: `${String(item.percentage)}%`,
                                backgroundColor: color,
                              }}
                            />
                          </span>
                          <span className="shrink-0 text-xs whitespace-nowrap text-muted-foreground tabular-nums">
                            {item.transactionCount} mov. ·{" "}
                            {formatPercent(item.percentage, locale)}
                          </span>
                        </span>
                        {budget !== undefined && (
                          <BudgetLine budget={budget} locale={locale} />
                        )}
                      </span>

                      {item.children.length > 0 && (
                        <ChevronDown
                          className={cn(
                            "size-4 shrink-0 text-muted-foreground transition-transform",
                            isOpen && "rotate-180",
                          )}
                        />
                      )}
                    </button>

                    {ids.length > 0 && (
                      <DrillDown
                        href={transactionsHref({
                          range,
                          kind,
                          categoryIds: ids,
                        })}
                        label={`Ver movimientos de ${item.name}`}
                      />
                    )}
                  </div>

                  {isOpen && (
                    <ul className="bg-secondary/40 pb-2 pl-4">
                      {item.children.map((child) => (
                        <li
                          key={child.categoryId ?? "none"}
                          className="flex items-center gap-2 py-1 pl-11 text-sm"
                        >
                          <span className="min-w-0 flex-1 truncate text-muted-foreground">
                            {child.name}
                          </span>
                          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                            {formatPercent(child.percentage, locale)}
                          </span>
                          <span className="shrink-0 tabular-nums">
                            {formatMoneyDTO(child.total, locale)}
                          </span>
                          {child.categoryId !== null ? (
                            <DrillDown
                              href={transactionsHref({
                                range,
                                kind,
                                categoryIds: [child.categoryId],
                              })}
                              label={`Ver movimientos de ${child.name}`}
                            />
                          ) : (
                            <span className="size-touch shrink-0" />
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </Card>
        </>
      )}
    </div>
  );
}

/** "450 € de 500 €" con el color del estado. Es el presupuesto vs. real. */
function BudgetLine({
  budget,
  locale,
}: {
  budget: BudgetWithStatus;
  locale: string;
}) {
  return (
    <span
      className={cn(
        "block text-[11px] tabular-nums",
        BUDGET_TONE[budget.state],
      )}
    >
      Presupuesto: {formatMoneyDTO(budget.spent, locale)} de{" "}
      {formatMoneyDTO(budget.effectiveAmount, locale)} ·{" "}
      {formatPercent(budget.percentage, locale)}
      {budget.state === "OVER" && " · pasado"}
    </span>
  );
}

// ───────────────────────────── comparativa ───────────────────────────────────

function Comparison({
  spaceId,
  locale,
  range,
}: {
  spaceId: string;
  locale: string;
  range: DateRange;
}) {
  const [kind, setKind] = useState<Kind>("EXPENSE");
  const [against, setAgainst] = useState<ComparisonTarget>("previous");

  const report = useQuery({
    queryKey: [
      ...spaceScopeKey(spaceId),
      "reports",
      "comparison",
      kind,
      against,
      range.start,
      range.end,
    ],
    queryFn: () =>
      api.get<ComparisonReport>(
        `/spaces/${spaceId}/reports/comparison${qs({
          kind,
          against,
          from: range.start,
          to: range.end,
        })}`,
      ),
    enabled: spaceId !== "",
    placeholderData: keepPreviousData,
  });

  if (report.data === undefined) return <ReportSkeleton />;

  const { delta, deltaPercentage, items, current, previous } = report.data;
  const deltaMinor = BigInt(delta.amountMinor);
  // En gastos, subir es malo. En ingresos, al revés.
  const isBad = kind === "EXPENSE" ? deltaMinor > 0n : deltaMinor < 0n;

  const currentLabel = describeRange(
    { start: current.from, end: current.to },
    locale,
  );
  const previousLabel = describeRange(
    { start: previous.from, end: previous.to },
    locale,
  );

  return (
    <div className={cn("space-y-4", report.isPlaceholderData && "opacity-60")}>
      <SegmentedToggle
        label="Tipo de movimiento"
        value={kind}
        options={KIND_OPTIONS}
        onChange={setKind}
      />

      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">Comparar con</span>
        <SegmentedToggle
          size="sm"
          label="Contra qué comparar"
          className="w-auto"
          value={against}
          options={[
            { value: "previous", label: "Período anterior" },
            { value: "year", label: "Año anterior" },
          ]}
          onChange={setAgainst}
        />
      </div>

      <Card className="gap-1 p-4">
        <p className="text-xs text-muted-foreground">
          {kind === "EXPENSE" ? "Gastos" : "Ingresos"} · {currentLabel}
        </p>
        <p className="flex items-baseline gap-2">
          <span className="text-2xl font-semibold tabular-nums">
            {formatMoneyDTO(report.data.currentTotal, locale)}
          </span>
          {deltaMinor !== 0n && (
            <span
              className={cn(
                "flex items-center gap-0.5 text-sm tabular-nums",
                isBad ? "text-expense" : "text-income",
              )}
            >
              {deltaMinor > 0n ? (
                <TrendingUp className="size-3.5" />
              ) : (
                <TrendingDown className="size-3.5" />
              )}
              {deltaPercentage !== null
                ? formatPercent(deltaPercentage, locale, {
                    signDisplay: "always",
                  })
                : formatMoneyDTO(delta, locale, { signDisplay: "always" })}
            </span>
          )}
        </p>
        <p className="text-xs text-muted-foreground tabular-nums">
          {previousLabel}: {formatMoneyDTO(report.data.previousTotal, locale)}
        </p>
      </Card>

      {items.length === 0 ? (
        <Empty range={range} locale={locale} />
      ) : (
        <Card className="divide-y p-0">
          {items.map((item) => {
            const itemDelta = BigInt(item.delta.amountMinor);
            const itemIsBad =
              kind === "EXPENSE" ? itemDelta > 0n : itemDelta < 0n;

            return (
              <div
                key={item.categoryId ?? "none"}
                className="flex min-h-touch items-center gap-3 py-3 pl-4"
              >
                <span
                  className="flex size-8 shrink-0 items-center justify-center rounded-full"
                  style={{ backgroundColor: `${item.color ?? "#71717a"}26` }}
                >
                  <DynamicIcon
                    name={item.icon}
                    className="size-4"
                    style={{ color: item.color ?? undefined }}
                  />
                </span>

                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-medium">
                      {item.name}
                    </span>
                    {item.isNew && (
                      <span className="rounded-full bg-secondary px-1.5 text-[10px]">
                        nuevo
                      </span>
                    )}
                  </span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {formatMoneyDTO(item.previous, locale)} →{" "}
                    {formatMoneyDTO(item.current, locale)}
                  </span>
                </span>

                <span className="shrink-0 text-right tabular-nums">
                  <span
                    className={cn(
                      "block text-sm font-medium",
                      itemDelta === 0n
                        ? "text-muted-foreground"
                        : itemIsBad
                          ? "text-expense"
                          : "text-income",
                    )}
                  >
                    {formatMoneyDTO(item.delta, locale, {
                      signDisplay: "always",
                    })}
                  </span>
                  {item.deltaPercentage !== null && itemDelta !== 0n && (
                    <span className="block text-[11px] text-muted-foreground">
                      {formatPercent(item.deltaPercentage, locale, {
                        signDisplay: "always",
                      })}
                    </span>
                  )}
                </span>

                {item.categoryId !== null ? (
                  <DrillDown
                    href={transactionsHref({
                      range: { start: current.from, end: current.to },
                      kind,
                      categoryIds: [item.categoryId],
                    })}
                    label={`Ver movimientos de ${item.name}`}
                  />
                ) : (
                  <span className="size-touch shrink-0" />
                )}
              </div>
            );
          })}
        </Card>
      )}
    </div>
  );
}

// ─────────────────────────── por miembro ─────────────────────────────────────

function Members({
  spaceId,
  locale,
  range,
}: {
  spaceId: string;
  locale: string;
  range: DateRange;
}) {
  const [kind, setKind] = useState<Kind>("EXPENSE");

  const report = useQuery({
    queryKey: [
      ...spaceScopeKey(spaceId),
      "reports",
      "members",
      kind,
      range.start,
      range.end,
    ],
    queryFn: () =>
      api.get<MemberReport>(
        `/spaces/${spaceId}/reports/members${qs({
          kind,
          from: range.start,
          to: range.end,
        })}`,
      ),
    enabled: spaceId !== "",
    placeholderData: keepPreviousData,
  });

  if (report.data === undefined) return <ReportSkeleton />;

  return (
    <div className={cn("space-y-4", report.isPlaceholderData && "opacity-60")}>
      <SegmentedToggle
        label="Tipo de movimiento"
        value={kind}
        options={KIND_OPTIONS}
        onChange={setKind}
      />

      {report.data.items.length === 0 ? (
        <Empty range={range} locale={locale} />
      ) : (
        <Card className="divide-y p-0">
          {report.data.items.map((item) => (
            <div
              key={item.userId ?? item.name}
              className="flex items-center gap-2 py-3 pl-4"
            >
              <div className="min-w-0 flex-1 space-y-2">
                <div className="flex items-center gap-3">
                  <Avatar className="size-8">
                    {item.avatarUrl !== null && (
                      <AvatarImage src={item.avatarUrl} alt="" />
                    )}
                    <AvatarFallback className="text-xs">
                      {initials(item.name)}
                    </AvatarFallback>
                  </Avatar>

                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {item.name}
                    </span>
                    <span className="text-xs whitespace-nowrap text-muted-foreground tabular-nums">
                      {item.transactionCount} mov. ·{" "}
                      {formatPercent(item.percentage, locale)}
                    </span>
                  </span>

                  <span className="shrink-0 text-sm font-medium tabular-nums">
                    {formatMoneyDTO(item.total, locale)}
                  </span>
                </div>

                <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${String(item.percentage)}%` }}
                  />
                </div>
              </div>

              {item.userId !== null ? (
                <DrillDown
                  href={transactionsHref({ range, kind, userId: item.userId })}
                  label={`Ver movimientos de ${item.name}`}
                />
              ) : (
                <span className="size-touch shrink-0" />
              )}
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}

// ──────────────────────────── compartidos ────────────────────────────────────

/** Flecha a Movimientos con el filtro ya puesto. */
function DrillDown({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      aria-label={label}
      className="flex size-touch shrink-0 items-center justify-center text-muted-foreground active:opacity-70"
    >
      <ArrowUpRight className="size-4" />
    </Link>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "income" | "expense";
}) {
  return (
    <Card className="gap-0.5 p-3">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span
        className={cn(
          "truncate text-sm font-semibold tabular-nums",
          tone === "income" ? "text-income" : "text-expense",
        )}
      >
        {value}
      </span>
    </Card>
  );
}

function Empty({ range, locale }: { range: DateRange; locale: string }) {
  return (
    <div className="space-y-1 py-12 text-center">
      <p className="text-sm text-muted-foreground">
        No hay movimientos en este período
      </p>
      <p className="text-xs text-muted-foreground">
        {describeRange(range, locale)}
      </p>
    </div>
  );
}

function ReportSkeleton() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-10 w-full rounded-full" />
      <Skeleton className="h-48 w-full rounded-xl" />
      <Skeleton className="h-40 w-full rounded-xl" />
    </div>
  );
}

function PageSkeleton() {
  return (
    <div className="space-y-4 py-3">
      <h1 className="text-xl font-semibold">Reportes</h1>
      <Skeleton className="h-11 w-full rounded-md" />
      <Skeleton className="h-10 w-full rounded-full" />
      <Skeleton className="h-48 w-full rounded-xl" />
    </div>
  );
}
