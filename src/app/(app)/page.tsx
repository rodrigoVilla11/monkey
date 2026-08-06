"use client";

import dynamic from "next/dynamic";
import {
  ChevronRight,
  PiggyBank,
  TrendingDown,
  TrendingUp,
  TriangleAlert,
} from "lucide-react";
import Link from "next/link";

import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatMoneyDTO } from "@/lib/format";
import { useDashboard } from "@/lib/hooks/use-domain";
import { useActiveSpace, useSession } from "@/lib/hooks/use-session";
import { cn } from "@/lib/utils";

/**
 * Recharts pesa más de 100 kB y solo hace falta en esta pantalla.
 * Con `ssr: false` además se evita renderizar SVG en el servidor para
 * descartarlo en la hidratación.
 */
const CategoryDonut = dynamic(
  () =>
    import("@/components/charts/category-donut").then((m) => m.CategoryDonut),
  {
    ssr: false,
    loading: () => <Skeleton className="h-52 w-full rounded-xl" />,
  },
);

export default function DashboardPage() {
  const session = useSession();
  const { space } = useActiveSpace();
  const spaceId = space?.id ?? "";
  const dashboard = useDashboard(spaceId);

  const locale = session.data?.locale ?? "es-ES";

  if (dashboard.data === undefined) {
    return (
      <div className="space-y-4 py-3">
        <Skeleton className="h-28 w-full rounded-xl" />
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-52 w-full rounded-xl" />
      </div>
    );
  }

  const {
    netWorth,
    month,
    previousMonth,
    accounts,
    topExpenseCategories,
    byMember,
  } = dashboard.data;

  const delta =
    BigInt(month.net.amountMinor) - BigInt(previousMonth.net.amountMinor);

  return (
    <div className="space-y-4 py-3">
      {/* Patrimonio neto */}
      <Card className="gap-2 p-5">
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Patrimonio neto
        </p>
        <p className="text-3xl font-semibold tabular-nums">
          {netWorth.converted !== null
            ? formatMoneyDTO(netWorth.converted, locale)
            : formatMoneyDTO(netWorth.byCurrency[0] ?? month.net, locale)}
        </p>

        {/* Si hay varias monedas se muestran todas: el total convertido usa la
            última cotización conocida y es una estimación, no un dato. */}
        {netWorth.byCurrency.length > 1 && (
          <p className="text-xs text-muted-foreground tabular-nums">
            {netWorth.byCurrency
              .map((value) => formatMoneyDTO(value, locale))
              .join("  ·  ")}
          </p>
        )}
        {netWorth.missingRates.length > 0 && (
          <p className="text-xs text-muted-foreground">
            No se pudo convertir {netWorth.missingRates.join(", ")}: falta la
            cotización
          </p>
        )}
      </Card>

      {/* Ingresos vs egresos del mes */}
      <div className="grid grid-cols-2 gap-3">
        <Card className="gap-1 p-4">
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <TrendingUp className="size-3.5 text-income" />
            Ingresos
          </span>
          <span className="text-lg font-semibold text-income tabular-nums">
            {formatMoneyDTO(month.income, locale)}
          </span>
        </Card>
        <Card className="gap-1 p-4">
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <TrendingDown className="size-3.5 text-expense" />
            Gastos
          </span>
          <span className="text-lg font-semibold text-expense tabular-nums">
            {formatMoneyDTO(month.expense, locale)}
          </span>
        </Card>
      </div>

      <Card className="flex-row items-center justify-between p-4">
        <div>
          <p className="text-xs text-muted-foreground">Balance del mes</p>
          <p
            className={cn(
              "text-xl font-semibold tabular-nums",
              BigInt(month.net.amountMinor) < 0n
                ? "text-expense"
                : "text-income",
            )}
          >
            {formatMoneyDTO(month.net, locale, { signDisplay: "always" })}
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs text-muted-foreground">vs. mes anterior</p>
          <p className="text-sm tabular-nums">
            {formatMoneyDTO(
              { amountMinor: delta.toString(), currency: month.net.currency },
              locale,
              { signDisplay: "always" },
            )}
          </p>
        </div>
      </Card>

      {/* Presupuestos: solo aparece si hay alguno. Una tarjeta vacía
          prometiendo una función es ruido. */}
      {dashboard.data.budgets.total > 0 && (
        <Link href="/budgets" className="block active:opacity-70">
          <Card className="gap-2 p-4">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-sm font-semibold">
                <PiggyBank className="size-4" />
                Presupuestos
              </span>
              <ChevronRight className="size-4 text-muted-foreground" />
            </div>

            <p className="text-xs text-muted-foreground tabular-nums">
              {formatMoneyDTO(dashboard.data.budgets.totalSpent, locale)} de{" "}
              {formatMoneyDTO(dashboard.data.budgets.totalAmount, locale)}
            </p>

            {(dashboard.data.budgets.overBudget > 0 ||
              dashboard.data.budgets.nearLimit > 0) && (
              <p
                className={cn(
                  "flex items-center gap-1.5 text-xs",
                  dashboard.data.budgets.overBudget > 0
                    ? "text-expense"
                    : "text-amber-500",
                )}
              >
                <TriangleAlert className="size-3.5 shrink-0" />
                {dashboard.data.budgets.overBudget > 0
                  ? `${String(dashboard.data.budgets.overBudget)} pasado${dashboard.data.budgets.overBudget > 1 ? "s" : ""} del límite`
                  : `${String(dashboard.data.budgets.nearLimit)} cerca del límite`}
              </p>
            )}
          </Card>
        </Link>
      )}

      {/* Saldo por cuenta */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Cuentas</h2>
          <Link href="/accounts" className="text-xs text-muted-foreground">
            Ver todas
          </Link>
        </div>
        <Card className="divide-y p-0">
          {accounts.map((account) => (
            <div
              key={account.accountId}
              className="flex min-h-touch items-center justify-between px-4 py-3"
            >
              <span className="flex items-center gap-2 text-sm">
                <span
                  className="size-2.5 rounded-full"
                  style={{ backgroundColor: account.color ?? "var(--muted)" }}
                  aria-hidden
                />
                {account.name}
              </span>
              <span
                className={cn(
                  "text-sm font-medium tabular-nums",
                  BigInt(account.balance.amountMinor) < 0n && "text-expense",
                )}
              >
                {formatMoneyDTO(account.balance, locale)}
              </span>
            </div>
          ))}
        </Card>
      </section>

      {/* Top categorías */}
      {topExpenseCategories.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">En qué se fue el mes</h2>
            <Link href="/reports" className="text-xs text-muted-foreground">
              Ver reportes
            </Link>
          </div>
          <Card className="p-4">
            <CategoryDonut data={topExpenseCategories} locale={locale} />
          </Card>
        </section>
      )}

      {/* Desglose por miembro: solo en Spaces compartidos */}
      {byMember.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">Quién gastó qué</h2>
          <Card className="divide-y p-0">
            {byMember.map((member) => (
              <div
                key={member.userId ?? member.name}
                className="flex min-h-touch items-center justify-between px-4 py-3"
              >
                <span className="text-sm">
                  {member.name}
                  <span className="ml-1.5 text-xs text-muted-foreground">
                    {member.transactionCount} mov.
                  </span>
                </span>
                <span className="text-sm font-medium tabular-nums">
                  {formatMoneyDTO(member.total, locale)}
                </span>
              </div>
            ))}
          </Card>
        </section>
      )}
    </div>
  );
}
