"use client";

import dynamic from "next/dynamic";
import {
  Check,
  ChevronRight,
  CircleDashed,
  PiggyBank,
  Target,
  TrendingDown,
  TrendingUp,
  TriangleAlert,
  X,
} from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";

import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatMoneyDTO, formatSignedAmount } from "@/lib/format";
import {
  useDashboard,
  useDeleteTransaction,
  useUpdateTransaction,
} from "@/lib/hooks/use-domain";
import { useActiveSpace, useSession } from "@/lib/hooks/use-session";
import { cn } from "@/lib/utils";
import type { PendingSummary } from "@/shared/contracts/reports";
import { formatCalendarDate } from "@/shared/dates";
import { hasAtLeast } from "@/shared/roles";

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
    goalReminders,
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

      {/**
       * Movimientos programados que nacieron pendientes de revisar. Es la
       * bandeja de entrada del inicio: se aceptan o descartan acá mismo, sin
       * pasar por Movimientos. Solo aparece si hay algo que revisar.
       */}
      {dashboard.data.pendingTransactions.count > 0 && (
        <PendingCard
          pending={dashboard.data.pendingTransactions}
          spaceId={spaceId}
          locale={locale}
          canEdit={space !== undefined && hasAtLeast(space.role, "MEMBER")}
        />
      )}

      {/**
       * Metas con plan. Es un recordatorio, no un informe: dice lo que toca
       * hacer —"apartá 156,25 el domingo"— y nada más. El progreso está en su
       * pantalla. Solo aparece si hay alguna con una forma elegida; sin eso no
       * hay nada que recordar.
       */}
      {goalReminders.length > 0 && (
        <Link href="/goals" className="block active:opacity-70">
          <Card className="gap-2 p-4">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-sm font-semibold">
                <Target className="size-4" />
                Para tus metas
              </span>
              <ChevronRight className="size-4 text-muted-foreground" />
            </div>

            {goalReminders.map((goal) => (
              <div key={goal.id} className="flex items-baseline gap-2">
                <span
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: goal.color ?? "var(--primary)" }}
                  aria-hidden
                />
                <span className="min-w-0 flex-1 truncate text-xs">
                  {goal.name}
                </span>
                <span
                  className={cn(
                    "shrink-0 text-xs tabular-nums",
                    BigInt(goal.behind.amountMinor) > 0n
                      ? "text-expense"
                      : "text-muted-foreground",
                  )}
                >
                  {BigInt(goal.behind.amountMinor) > 0n
                    ? `te falta apartar ${formatMoneyDTO(goal.behind, locale)}`
                    : goal.nextDate !== null
                      ? `${formatMoneyDTO(goal.amount, locale)} el ${formatCalendarDate(
                          goal.nextDate,
                          locale,
                          { day: "numeric", month: "short" },
                        )}`
                      : formatMoneyDTO(goal.amount, locale)}
                </span>
              </div>
            ))}
          </Card>
        </Link>
      )}

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
              <span className="text-right">
                <span
                  className={cn(
                    "block text-sm font-medium tabular-nums",
                    BigInt(account.balance.amountMinor) < 0n && "text-expense",
                  )}
                >
                  {formatMoneyDTO(account.balance, locale)}
                </span>
                {/* Si hay plata con dueño, el saldo solo no alcanza: gastar
                    hasta ahí sería comerse una meta. Se dice acá en chico y el
                    desglose por meta vive en Cuentas. */}
                {BigInt(account.reserved.amountMinor) > 0n && (
                  <span
                    className={cn(
                      "block text-[11px] text-muted-foreground tabular-nums",
                      BigInt(account.available.amountMinor) < 0n &&
                        "text-expense",
                    )}
                  >
                    {formatMoneyDTO(account.available, locale)} disponible
                  </span>
                )}
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

/**
 * Tarjeta de movimientos por confirmar.
 *
 * Confirmar es un PATCH a CLEARED; descartar borra el movimiento — la
 * ocurrencia programada que al final no pasó (la suscripción que no se cobró)
 * no tiene por qué quedar ensuciando los saldos. Sin permiso de escritura la
 * tarjeta igual se muestra, pero sin acciones: un VIEWER puede enterarse, no
 * decidir.
 */
function PendingCard({
  pending,
  spaceId,
  locale,
  canEdit,
}: {
  pending: PendingSummary;
  spaceId: string;
  locale: string;
  canEdit: boolean;
}) {
  const update = useUpdateTransaction(spaceId);
  const remove = useDeleteTransaction(spaceId);
  const busy = update.isPending || remove.isPending;

  const confirm = (id: string) => {
    update.mutate(
      { id, status: "CLEARED" },
      {
        onSuccess: () => {
          toast.success("Movimiento confirmado");
        },
      },
    );
  };

  const discard = (id: string) => {
    remove.mutate(id, {
      onSuccess: () => {
        toast.success("Movimiento descartado");
      },
    });
  };

  return (
    <Card className="gap-2 p-4">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-sm font-semibold">
          <CircleDashed className="size-4" />
          Por confirmar
        </span>
        <span className="text-xs text-muted-foreground tabular-nums">
          {pending.count}
        </span>
      </div>

      <div className="divide-y">
        {pending.items.map((item) => (
          <div key={item.id} className="flex items-center gap-2 py-1.5">
            <span
              className="size-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: item.categoryColor ?? "var(--muted)" }}
              aria-hidden
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-medium">
                {item.description ?? item.categoryName ?? "Sin descripción"}
              </span>
              <span className="block truncate text-[11px] text-muted-foreground">
                {formatCalendarDate(item.date, locale, {
                  day: "numeric",
                  month: "short",
                })}
                {" · "}
                {item.accountName}
              </span>
            </span>
            <span
              className={cn(
                "shrink-0 text-xs font-semibold tabular-nums",
                item.type === "INCOME" && "text-income",
              )}
            >
              {formatSignedAmount(item.amount, item.type, locale)}
            </span>

            {canEdit && (
              <span className="flex shrink-0 items-center">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    confirm(item.id);
                  }}
                  aria-label="Confirmar movimiento"
                  className="flex min-h-touch min-w-touch items-center justify-center text-income disabled:opacity-40"
                >
                  <Check className="size-4.5" />
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    discard(item.id);
                  }}
                  aria-label="Descartar movimiento"
                  className="flex min-h-touch min-w-touch items-center justify-center text-muted-foreground disabled:opacity-40"
                >
                  <X className="size-4.5" />
                </button>
              </span>
            )}
          </div>
        ))}
      </div>

      {pending.count > pending.items.length && (
        <Link
          href="/transactions"
          className="flex items-center gap-0.5 text-xs text-muted-foreground"
        >
          y {pending.count - pending.items.length} más en Movimientos
          <ChevronRight className="size-3.5" />
        </Link>
      )}
    </Card>
  );
}
