import type { MoneyDTO } from "@/shared/contracts/common";
import { formatCalendarDate, todayIn, type CalendarDate } from "@/shared/dates";
import { formatMoney, money } from "@/shared/money";

/**
 * Formateo para la UI.
 *
 * Envuelve los helpers puros de `shared/` traduciendo el DTO de transporte
 * (importe como string) a los tipos que espera la lógica de dominio. La
 * conversión pasa por `BigInt`, nunca por `Number`.
 */

export const formatMoneyDTO = (
  value: MoneyDTO,
  locale: string,
  options?: { hideSymbol?: boolean; signDisplay?: "auto" | "always" | "never" },
): string =>
  formatMoney(
    money(BigInt(value.amountMinor), value.currency),
    locale,
    options ?? {},
  );

/** Importe con signo según el tipo de movimiento. */
export const formatSignedAmount = (
  value: MoneyDTO,
  type: "INCOME" | "EXPENSE" | "TRANSFER",
  locale: string,
): string => {
  const amount = BigInt(value.amountMinor);
  const signed = type === "EXPENSE" ? -amount : amount;
  return formatMoney(money(signed, value.currency), locale, {
    signDisplay: type === "INCOME" ? "always" : "auto",
  });
};

export const isNegative = (value: MoneyDTO): boolean =>
  BigInt(value.amountMinor) < 0n;

/**
 * Encabezado de un grupo de días en el listado.
 * "Hoy" y "Ayer" en vez de la fecha: es lo que uno busca al abrir la app.
 */
export const formatDayHeading = (
  date: CalendarDate,
  locale: string,
  timezone: string,
): string => {
  const today = todayIn(timezone);
  if (date === today) return "Hoy";

  const yesterday = shiftDay(today, -1);
  if (date === yesterday) return "Ayer";

  return formatCalendarDate(date, locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
};

const shiftDay = (date: CalendarDate, days: number): CalendarDate => {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};

/** Iniciales para el avatar cuando no hay foto. */
export const initials = (name: string): string =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");

/**
 * Convierte lo tecleado en el pad numérico a unidades mínimas.
 *
 * El pad acumula dígitos de derecha a izquierda —como una caja registradora—
 * así que lo que se teclea YA son unidades mínimas. No hay parseo de
 * separadores y por lo tanto no hay ambigüedad posible.
 */
export const digitsToMinor = (digits: string): bigint =>
  digits === "" ? 0n : BigInt(digits);
