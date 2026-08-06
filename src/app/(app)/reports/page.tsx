"use client";

import { useQuery } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import { ChevronDown, TrendingDown, TrendingUp } from "lucide-react";
import { useState } from "react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card } from "@/components/ui/card";
import { DynamicIcon } from "@/components/ui/dynamic-icon";
import { Skeleton } from "@/components/ui/skeleton";
import { api, qs } from "@/lib/api-client";
import { formatMoneyDTO, initials } from "@/lib/format";
import { useActiveSpace, useSession } from "@/lib/hooks/use-session";
import { spaceScopeKey } from "@/lib/query-keys";
import { cn } from "@/lib/utils";
import type {
  CategoryReport,
  ComparisonReport,
  MemberReport,
  MonthlyReport,
} from "@/shared/contracts/reports-v2";

/** Recharts pesa >100 kB y solo hace falta en esta pantalla. */
const MonthlyChart = dynamic(
  () => import("@/components/charts/monthly-chart").then((m) => m.MonthlyChart),
  {
    ssr: false,
    loading: () => <Skeleton className="h-48 w-full rounded-xl" />,
  },
);
const MonthlyTable = dynamic(
  () => import("@/components/charts/monthly-chart").then((m) => m.MonthlyTable),
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
    loading: () => <Skeleton className="h-52 w-full rounded-xl" />,
  },
);

const TABS = [
  { id: "evolution", label: "Evolución" },
  { id: "categories", label: "Categorías" },
  { id: "comparison", label: "Mes a mes" },
  { id: "members", label: "Miembros" },
] as const;

type Tab = (typeof TABS)[number]["id"];

/**
 * Reportes.
 *
 * Pestañas y no una sola pantalla larga: cada reporte es una consulta pesada y
 * cargarlas todas juntas haría esperar por datos que quizá nadie mire. Cada
 * pestaña pide lo suyo cuando se abre.
 */
export default function ReportsPage() {
  const session = useSession();
  const { space } = useActiveSpace();
  const spaceId = space?.id ?? "";
  const [tab, setTab] = useState<Tab>("evolution");

  const locale = session.data?.locale ?? "es-ES";
  const isShared = (space?.memberCount ?? 1) > 1;

  const visible = TABS.filter((t) => t.id !== "members" || isShared);

  return (
    <div className="space-y-4 py-3">
      <h1 className="text-xl font-semibold">Reportes</h1>

      {/* Pestañas con scroll horizontal: a 375px no entran cuatro fijas. */}
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        {visible.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => {
              setTab(item.id);
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

      {tab === "evolution" && <Evolution spaceId={spaceId} locale={locale} />}
      {tab === "categories" && <Categories spaceId={spaceId} locale={locale} />}
      {tab === "comparison" && <Comparison spaceId={spaceId} locale={locale} />}
      {tab === "members" && <Members spaceId={spaceId} locale={locale} />}
    </div>
  );
}

// ───────────────────────────── evolución ─────────────────────────────────────

function Evolution({ spaceId, locale }: { spaceId: string; locale: string }) {
  const [months, setMonths] = useState(6);
  const [mode, setMode] = useState<"flow" | "balance">("flow");

  const report = useQuery({
    queryKey: [...spaceScopeKey(spaceId), "reports", "monthly", months],
    queryFn: () =>
      api.get<MonthlyReport>(
        `/spaces/${spaceId}/reports/monthly${qs({ months })}`,
      ),
    enabled: spaceId !== "",
  });

  if (report.data === undefined) return <ReportSkeleton />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex rounded-full bg-secondary p-0.5">
          {(
            [
              ["flow", "Ingresos y gastos"],
              ["balance", "Patrimonio"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => {
                setMode(value);
              }}
              className={cn(
                "rounded-full px-3 py-1.5 text-xs",
                mode === value && "bg-background shadow-sm",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <select
          value={months}
          onChange={(e) => {
            setMonths(Number(e.target.value));
          }}
          aria-label="Cantidad de meses"
          className="min-h-touch rounded-lg border bg-background px-2 text-sm"
        >
          {[3, 6, 12, 24].map((value) => (
            <option key={value} value={value}>
              {value} meses
            </option>
          ))}
        </select>
      </div>

      <Card className="p-4">
        <MonthlyChart points={report.data.points} mode={mode} />
      </Card>

      <div className="grid grid-cols-3 gap-2">
        <Stat
          label="Ingreso medio"
          value={formatMoneyDTO(report.data.averageIncome, locale)}
          tone="income"
        />
        <Stat
          label="Gasto medio"
          value={formatMoneyDTO(report.data.averageExpense, locale)}
          tone="expense"
        />
        <Stat
          label="Ahorro medio"
          value={formatMoneyDTO(report.data.averageNet, locale)}
          tone={
            BigInt(report.data.averageNet.amountMinor) < 0n
              ? "expense"
              : "income"
          }
        />
      </div>

      <Card className="p-4">
        <MonthlyTable points={report.data.points} locale={locale} mode={mode} />
      </Card>
    </div>
  );
}

// ─────────────────────────── por categoría ───────────────────────────────────

function Categories({ spaceId, locale }: { spaceId: string; locale: string }) {
  const [kind, setKind] = useState<"EXPENSE" | "INCOME">("EXPENSE");
  const [expanded, setExpanded] = useState<string | null>(null);

  const report = useQuery({
    queryKey: [...spaceScopeKey(spaceId), "reports", "categories", kind],
    queryFn: () =>
      api.get<CategoryReport>(
        `/spaces/${spaceId}/reports/categories${qs({ kind })}`,
      ),
    enabled: spaceId !== "",
  });

  if (report.data === undefined) return <ReportSkeleton />;

  const items = report.data.items;

  return (
    <div className="space-y-4">
      <KindToggle kind={kind} onChange={setKind} />

      {items.length === 0 ? (
        <Empty />
      ) : (
        <>
          <Card className="p-4">
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
            />
          </Card>

          <Card className="divide-y p-0">
            {items.map((item) => (
              <div key={item.categoryId ?? "none"}>
                <button
                  type="button"
                  disabled={item.children.length === 0}
                  onClick={() => {
                    setExpanded(
                      expanded === item.categoryId ? null : item.categoryId,
                    );
                  }}
                  className="flex min-h-touch w-full items-center gap-3 px-4 py-3 text-left"
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
                    <span className="block truncate text-sm font-medium">
                      {item.name}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {item.transactionCount} mov. · {item.percentage}%
                    </span>
                  </span>

                  <span className="shrink-0 text-sm font-medium tabular-nums">
                    {formatMoneyDTO(item.total, locale)}
                  </span>

                  {item.children.length > 0 && (
                    <ChevronDown
                      className={cn(
                        "size-4 shrink-0 text-muted-foreground transition-transform",
                        expanded === item.categoryId && "rotate-180",
                      )}
                    />
                  )}
                </button>

                {expanded === item.categoryId && (
                  <ul className="bg-secondary/40 px-4 pb-2">
                    {item.children.map((child) => (
                      <li
                        key={child.categoryId ?? "none"}
                        className="flex items-center justify-between py-2 pl-11 text-sm"
                      >
                        <span className="truncate text-muted-foreground">
                          {child.name}
                        </span>
                        <span className="tabular-nums">
                          {formatMoneyDTO(child.total, locale)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </Card>
        </>
      )}
    </div>
  );
}

// ────────────────────────── comparativa mes a mes ────────────────────────────

function Comparison({ spaceId, locale }: { spaceId: string; locale: string }) {
  const [kind, setKind] = useState<"EXPENSE" | "INCOME">("EXPENSE");

  const report = useQuery({
    queryKey: [...spaceScopeKey(spaceId), "reports", "comparison", kind],
    queryFn: () =>
      api.get<ComparisonReport>(
        `/spaces/${spaceId}/reports/comparison${qs({ kind })}`,
      ),
    enabled: spaceId !== "",
  });

  if (report.data === undefined) return <ReportSkeleton />;

  const { delta, deltaPercentage, items } = report.data;
  const deltaMinor = BigInt(delta.amountMinor);
  // En gastos, subir es malo. En ingresos, al revés.
  const isBad = kind === "EXPENSE" ? deltaMinor > 0n : deltaMinor < 0n;

  return (
    <div className="space-y-4">
      <KindToggle kind={kind} onChange={setKind} />

      <Card className="gap-1 p-4">
        <p className="text-xs text-muted-foreground">
          {kind === "EXPENSE" ? "Gastos" : "Ingresos"} de este mes vs. el
          anterior
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
                ? `${String(Math.abs(deltaPercentage))}%`
                : formatMoneyDTO(delta, locale, { signDisplay: "always" })}
            </span>
          )}
        </p>
        <p className="text-xs text-muted-foreground tabular-nums">
          Mes anterior: {formatMoneyDTO(report.data.previousTotal, locale)}
        </p>
      </Card>

      {items.length === 0 ? (
        <Empty />
      ) : (
        <Card className="divide-y p-0">
          {items.map((item) => {
            const itemDelta = BigInt(item.delta.amountMinor);
            const itemIsBad =
              kind === "EXPENSE" ? itemDelta > 0n : itemDelta < 0n;

            return (
              <div
                key={item.categoryId ?? "none"}
                className="flex min-h-touch items-center gap-3 px-4 py-3"
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

                <span
                  className={cn(
                    "shrink-0 text-right text-sm font-medium tabular-nums",
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
              </div>
            );
          })}
        </Card>
      )}
    </div>
  );
}

// ─────────────────────────── por miembro ─────────────────────────────────────

function Members({ spaceId, locale }: { spaceId: string; locale: string }) {
  const [kind, setKind] = useState<"EXPENSE" | "INCOME">("EXPENSE");

  const report = useQuery({
    queryKey: [...spaceScopeKey(spaceId), "reports", "members", kind],
    queryFn: () =>
      api.get<MemberReport>(
        `/spaces/${spaceId}/reports/members${qs({ kind })}`,
      ),
    enabled: spaceId !== "",
  });

  if (report.data === undefined) return <ReportSkeleton />;

  return (
    <div className="space-y-4">
      <KindToggle kind={kind} onChange={setKind} />

      {report.data.items.length === 0 ? (
        <Empty />
      ) : (
        <Card className="divide-y p-0">
          {report.data.items.map((item) => (
            <div key={item.userId ?? item.name} className="space-y-2 px-4 py-3">
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
                  <span className="text-xs text-muted-foreground">
                    {item.transactionCount} mov. · {item.percentage}%
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
          ))}
        </Card>
      )}
    </div>
  );
}

// ──────────────────────────── compartidos ────────────────────────────────────

function KindToggle({
  kind,
  onChange,
}: {
  kind: "EXPENSE" | "INCOME";
  onChange: (value: "EXPENSE" | "INCOME") => void;
}) {
  return (
    <div className="flex rounded-full bg-secondary p-0.5">
      {(
        [
          ["EXPENSE", "Gastos"],
          ["INCOME", "Ingresos"],
        ] as const
      ).map(([value, label]) => (
        <button
          key={value}
          type="button"
          onClick={() => {
            onChange(value);
          }}
          className={cn(
            "min-h-touch flex-1 rounded-full text-sm",
            kind === value && "bg-background shadow-sm",
          )}
        >
          {label}
        </button>
      ))}
    </div>
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
          "text-sm font-semibold tabular-nums",
          tone === "income" ? "text-income" : "text-expense",
        )}
      >
        {value}
      </span>
    </Card>
  );
}

function Empty() {
  return (
    <p className="py-12 text-center text-sm text-muted-foreground">
      No hay movimientos en este período
    </p>
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
