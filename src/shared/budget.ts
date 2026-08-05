import {
  addDays,
  addMonths,
  differenceInDays,
  endOfMonth,
  startOfMonth,
  type CalendarDate,
  type DateRange,
} from "./dates";

/**
 * Presupuestos: aritmética de períodos y estado.
 *
 * Lógica pura, sin base de datos, en `shared/` para que se testee sola y para
 * que un cliente nativo pueda pintar la barra de progreso sin esperar al
 * servidor.
 */

export type BudgetPeriodKind = "MONTHLY" | "WEEKLY" | "CUSTOM";

/**
 * Período que contiene a `today`.
 *
 * · MONTHLY — mes CALENDARIO, no "30 días desde que lo creaste". Es lo que
 *   quiere decir cualquiera con "presupuesto mensual", y hace que coincida con
 *   el resumen del mes del dashboard. El primer período puede ser parcial si
 *   el presupuesto se creó a mitad de mes.
 * · WEEKLY — ventanas de 7 días ancladas al `startDate`. Se ancla ahí y no al
 *   `weekStartsOn` de cada persona porque el presupuesto es del Space y sus
 *   miembros pueden tener configuraciones distintas: el mismo presupuesto no
 *   puede empezar en días diferentes según quién lo mire.
 * · CUSTOM — un único período [startDate, endDate].
 */
export const currentPeriod = (
  kind: BudgetPeriodKind,
  startDate: CalendarDate,
  endDate: CalendarDate | null,
  today: CalendarDate,
): DateRange => {
  switch (kind) {
    case "CUSTOM":
      return { start: startDate, end: endDate ?? today };

    case "MONTHLY": {
      const anchor = today < startDate ? startDate : today;
      // El primer período arranca cuando arranca el presupuesto, no el día 1.
      const start = maxDate(startOfMonth(anchor), startDate);
      return { start, end: endOfMonth(anchor) };
    }

    case "WEEKLY": {
      if (today < startDate)
        return { start: startDate, end: addDays(startDate, 6) };
      const elapsed = Math.floor(differenceInDays(startDate, today) / 7);
      const start = addDays(startDate, elapsed * 7);
      return { start, end: addDays(start, 6) };
    }
  }
};

/**
 * Cuántos períodos transcurrieron desde `startDate` hasta hoy, contando el
 * actual. Es el multiplicador del rollover: con 3 períodos transcurridos, el
 * total presupuestado acumulado es `monto × 3`.
 */
export const elapsedPeriods = (
  kind: BudgetPeriodKind,
  startDate: CalendarDate,
  today: CalendarDate,
): number => {
  if (today < startDate) return 0;

  switch (kind) {
    case "CUSTOM":
      return 1;

    case "MONTHLY": {
      const months = monthsBetween(startDate, today);
      return months + 1;
    }

    case "WEEKLY":
      return Math.floor(differenceInDays(startDate, today) / 7) + 1;
  }
};

const monthsBetween = (from: CalendarDate, to: CalendarDate): number => {
  const [fromYear, fromMonth] = splitYearMonth(from);
  const [toYear, toMonth] = splitYearMonth(to);
  return (toYear - fromYear) * 12 + (toMonth - fromMonth);
};

const splitYearMonth = (date: CalendarDate): [number, number] => [
  Number(date.slice(0, 4)),
  Number(date.slice(5, 7)),
];

const maxDate = (a: CalendarDate, b: CalendarDate): CalendarDate =>
  a >= b ? a : b;

/** ¿El presupuesto ya terminó? Solo aplica a CUSTOM y a los que tienen fin. */
export const hasEnded = (
  endDate: CalendarDate | null,
  today: CalendarDate,
): boolean => endDate !== null && today > endDate;

/** Período siguiente, para mostrar "se renueva el …". */
export const nextPeriodStart = (
  kind: BudgetPeriodKind,
  period: DateRange,
): CalendarDate | null => {
  switch (kind) {
    case "CUSTOM":
      return null;
    case "MONTHLY":
      return startOfMonth(addMonths(period.end, 1));
    case "WEEKLY":
      return addDays(period.end, 1);
  }
};

// ──────────────────────────────── estado ─────────────────────────────────────

export type BudgetState = "OK" | "WARNING" | "OVER";

/** A partir del 80% se avisa: da margen para corregir antes de pasarse. */
export const WARNING_THRESHOLD = 80;

export interface BudgetStatusInput {
  /** Tope por período. */
  readonly amountMinor: bigint;
  readonly rollover: boolean;
  /** Períodos transcurridos incluyendo el actual. */
  readonly elapsedPeriods: number;
  /** Gastado en el período actual. */
  readonly periodSpentMinor: bigint;
  /** Gastado desde el inicio del presupuesto, incluido el período actual. */
  readonly totalSpentMinor: bigint;
}

export interface BudgetStatus {
  /** Tope efectivo del período: con rollover incluye lo que sobró o faltó. */
  readonly effectiveAmountMinor: bigint;
  readonly periodSpentMinor: bigint;
  /** Puede ser negativo: es el sobregiro. */
  readonly remainingMinor: bigint;
  /** 0–100 para la barra; el porcentaje real puede pasarse de 100. */
  readonly percentage: number;
  readonly rawPercentage: number;
  readonly state: BudgetState;
  /** Cuánto arrastró del acumulado. 0 si no hay rollover. */
  readonly carriedMinor: bigint;
}

/**
 * Estado de un presupuesto.
 *
 * El rollover se calcula acumulado desde el inicio y en O(1), sin iterar
 * período por período:
 *
 *   presupuestado acumulado = monto × períodos transcurridos
 *   disponible del período  = presupuestado acumulado − gastado antes de este
 *
 * Así, pasarse un mes se come el siguiente —que es lo que significa un sobre—
 * y ahorrar lo suma. Sin rollover, cada período arranca limpio.
 */
export const budgetStatus = (input: BudgetStatusInput): BudgetStatus => {
  const spentBefore = input.totalSpentMinor - input.periodSpentMinor;

  const effectiveAmountMinor = input.rollover
    ? input.amountMinor * BigInt(Math.max(input.elapsedPeriods, 1)) -
      spentBefore
    : input.amountMinor;

  const carriedMinor = input.rollover
    ? effectiveAmountMinor - input.amountMinor
    : 0n;

  const remainingMinor = effectiveAmountMinor - input.periodSpentMinor;

  // Un tope efectivo en cero o negativo (se gastó de más en períodos previos)
  // se muestra al 100%: ya no queda nada, sin importar el número exacto.
  const rawPercentage =
    effectiveAmountMinor <= 0n
      ? input.periodSpentMinor > 0n
        ? 100
        : 0
      : percentage(input.periodSpentMinor, effectiveAmountMinor);

  return {
    effectiveAmountMinor,
    periodSpentMinor: input.periodSpentMinor,
    remainingMinor,
    percentage: Math.min(rawPercentage, 100),
    rawPercentage,
    state:
      remainingMinor < 0n
        ? "OVER"
        : rawPercentage >= WARNING_THRESHOLD
          ? "WARNING"
          : "OK",
    carriedMinor,
  };
};

/** Porcentaje con un decimal, calculado en enteros. */
const percentage = (part: bigint, total: bigint): number => {
  if (total === 0n) return 0;
  const abs = (value: bigint): bigint => (value < 0n ? -value : value);
  return Number((abs(part) * 1000n) / abs(total)) / 10;
};
