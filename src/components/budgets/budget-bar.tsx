"use client";

import { AlertTriangle, TriangleAlert } from "lucide-react";

import { DynamicIcon } from "@/components/ui/dynamic-icon";
import { formatMoneyDTO } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { BudgetWithStatus } from "@/shared/contracts/budgets";
import { formatCalendarDate } from "@/shared/dates";

/**
 * Barra de progreso de un presupuesto.
 *
 * El color sale del ESTADO, no del porcentaje: así "casi te pasás" y "te
 * pasaste" se distinguen de un vistazo sin leer números, que es lo que uno
 * hace al abrir la app.
 *
 * El importe grande es lo que QUEDA, no lo gastado. Es la pregunta que uno se
 * hace parado en la caja del súper.
 */
export function BudgetBar({
  budget,
  locale,
  onSelect,
}: {
  budget: BudgetWithStatus;
  locale: string;
  onSelect?: () => void;
}) {
  const isOver = budget.state === "OVER";
  const isWarning = budget.state === "WARNING";
  const carried = BigInt(budget.carried.amountMinor);
  const scope = scopeLabel(budget);

  const content = (
    <>
      <div className="flex items-center gap-3">
        <span
          className="flex size-9 shrink-0 items-center justify-center rounded-full"
          style={{
            backgroundColor: `${budget.category?.color ?? "#71717a"}26`,
          }}
        >
          <DynamicIcon
            name={budget.category?.icon}
            className="size-4.5"
            style={{ color: budget.category?.color ?? undefined }}
          />
        </span>

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{budget.name}</p>
          <p className="truncate text-xs text-muted-foreground">{scope}</p>
        </div>

        <div className="text-right">
          <p
            className={cn(
              "text-sm font-semibold tabular-nums",
              isOver && "text-expense",
            )}
          >
            {isOver ? "−" : ""}
            {formatMoneyDTO(
              {
                amountMinor: absolute(budget.remaining.amountMinor),
                currency: budget.remaining.currency,
              },
              locale,
            )}
          </p>
          <p className="text-xs text-muted-foreground">
            {isOver ? "de más" : "disponible"}
          </p>
        </div>
      </div>

      <div className="space-y-1.5">
        <div
          className="h-2 w-full overflow-hidden rounded-full bg-secondary"
          role="progressbar"
          aria-valuenow={budget.percentage}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${budget.name}: ${String(budget.percentage)}% usado`}
        >
          <div
            className={cn(
              "h-full rounded-full motion-safe:transition-[width]",
              isOver ? "bg-expense" : isWarning ? "bg-amber-500" : "bg-income",
            )}
            style={{ width: `${String(budget.percentage)}%` }}
          />
        </div>

        <div className="flex items-center justify-between text-xs text-muted-foreground tabular-nums">
          <span>
            {formatMoneyDTO(budget.spent, locale)} de{" "}
            {formatMoneyDTO(budget.effectiveAmount, locale)}
          </span>
          <span>{budget.percentage}%</span>
        </div>
      </div>

      {/* El arrastre solo se menciona cuando existe: si no, es ruido. */}
      {budget.rollover && carried !== 0n && (
        <p className="text-xs text-muted-foreground">
          {carried > 0n ? "Arrastra " : "Descuenta "}
          {formatMoneyDTO(
            {
              amountMinor: absolute(budget.carried.amountMinor),
              currency: budget.carried.currency,
            },
            locale,
          )}
          {carried > 0n
            ? " del período anterior"
            : " por el sobregiro anterior"}
        </p>
      )}

      {isOver && (
        <p className="flex items-center gap-1.5 text-xs text-expense">
          <TriangleAlert className="size-3.5 shrink-0" />
          Te pasaste del presupuesto
        </p>
      )}
      {isWarning && (
        <p className="flex items-center gap-1.5 text-xs text-amber-500">
          <AlertTriangle className="size-3.5 shrink-0" />
          Estás cerca del límite
        </p>
      )}

      {budget.nextPeriodStart !== null && (
        <p className="text-[11px] text-muted-foreground">
          Se renueva el{" "}
          {formatCalendarDate(budget.nextPeriodStart, locale, {
            day: "numeric",
            month: "long",
          })}
        </p>
      )}
    </>
  );

  if (onSelect === undefined) {
    return <div className="space-y-3">{content}</div>;
  }

  return (
    <button
      type="button"
      onClick={onSelect}
      className="min-h-touch w-full space-y-3 text-left active:opacity-70"
    >
      {content}
    </button>
  );
}

const absolute = (amountMinor: string): string =>
  amountMinor.startsWith("-") ? amountMinor.slice(1) : amountMinor;

/**
 * Qué alcanza el presupuesto, en una línea.
 *
 * Las cuentas se nombran una por una y no como "3 cuentas": con dos topes
 * sobre la misma categoría —tarjetas y efectivo—, el número no alcanza para
 * saber cuál de los dos se está mirando, que es justo la pregunta.
 */
const scopeLabel = (budget: BudgetWithStatus): string => {
  const category = budget.category?.name ?? "Todos los gastos";
  if (budget.accounts.length === 0) return category;
  return `${category} · ${budget.accounts.map((a) => a.name).join(", ")}`;
};
