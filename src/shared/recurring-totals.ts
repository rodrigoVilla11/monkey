import type { MoneyDTO } from "./contracts/common";
import type { RecurringRuleDTO } from "./contracts/recurring";
import type { CalendarDate } from "./dates";
import { occurrencesUpTo, type RecurrenceSpec } from "./recurrence";

/**
 * Cuánto suman los movimientos programados de acá a una fecha.
 *
 * No se suman los importes de las reglas: sumar un seguro anual con un alquiler
 * mensual da un número que no significa nada. Se cuentan las ocurrencias que
 * caen dentro del período con el MISMO motor que usa el job para
 * materializarlas, y cada una vale su importe. Así "3 meses" dice tres
 * alquileres y ningún seguro, que es lo que va a pasar de verdad.
 *
 * Vive en `shared/` y no en la pantalla porque el cliente nativo va a necesitar
 * la misma cuenta, y porque es lógica de dominio: la pantalla solo la muestra.
 *
 * Módulo puro: sin Next, sin Prisma, sin React.
 */

export interface ScheduledTotal {
  readonly currency: string;
  readonly income: MoneyDTO;
  readonly expense: MoneyDTO;
  /** income − expense. Lo que el período deja o se lleva. */
  readonly net: MoneyDTO;
}

/**
 * Tope duro por regla. Una diaria da 366 ocurrencias en un año, el rango más
 * largo que ofrece la pantalla; el margen está para que ampliarlo no empiece a
 * mentir en silencio.
 */
const OCCURRENCE_LIMIT = 400;

const specOf = (rule: RecurringRuleDTO): RecurrenceSpec => ({
  frequency: rule.frequency,
  interval: rule.interval,
  startDate: rule.startDate,
  endDate: rule.endDate,
  maxOccurrences: rule.maxOccurrences,
  byMonthDay: rule.byMonthDay,
  byWeekday: rule.byWeekday,
  byMonth: rule.byMonth,
});

const dto = (amountMinor: bigint, currency: string): MoneyDTO => ({
  amountMinor: amountMinor.toString(),
  currency,
});

/**
 * `until` es el único extremo que hace falta: el otro sale de cada regla. No se
 * recibe un rango porque su inicio sería mentira — una regla atrasada empieza a
 * contar antes de cualquier fecha que le pase la pantalla.
 */
export const scheduledTotals = (
  rules: readonly RecurringRuleDTO[],
  until: CalendarDate,
  primaryCurrency: string,
): ScheduledTotal[] => {
  const income = new Map<string, bigint>();
  const expense = new Map<string, bigint>();

  for (const rule of rules) {
    /**
     * Sin próxima fecha no hay nada que contar: la regla está pausada o ya se
     * terminó. Contarla igual sería prometer plata que nadie va a mover.
     */
    if (rule.nextRunDate === null) continue;

    /**
     * Se cuenta desde `nextRunDate`, no desde hoy. Lo anterior ya se
     * materializó y vive en el listado de movimientos: contarlo de nuevo sería
     * cobrarlo dos veces. Y si el job viene atrasado, `nextRunDate` quedó en el
     * pasado y esas ocurrencias vencidas se suman igual — todavía no existen
     * como transacción, así que siguen siendo plata que se va a mover.
     */
    if (rule.nextRunDate > until) continue;

    const { dates } = occurrencesUpTo(
      specOf(rule),
      rule.nextRunDate,
      until,
      OCCURRENCE_LIMIT,
    );
    if (dates.length === 0) continue;

    const total = BigInt(rule.amount.amountMinor) * BigInt(dates.length);
    const bucket = rule.type === "INCOME" ? income : expense;
    bucket.set(
      rule.amount.currency,
      (bucket.get(rule.amount.currency) ?? 0n) + total,
    );
  }

  const currencies = new Set([...income.keys(), ...expense.keys()]);

  /**
   * Cada moneda por separado y sin convertir: la conversión necesita
   * cotizaciones que solo tiene el servidor, y un total mezclado sería una
   * estimación disfrazada de dato. La principal del Space va primero.
   */
  return [...currencies]
    .sort((a, b) =>
      a === primaryCurrency
        ? -1
        : b === primaryCurrency
          ? 1
          : a.localeCompare(b),
    )
    .map((currency) => {
      const inMinor = income.get(currency) ?? 0n;
      const outMinor = expense.get(currency) ?? 0n;

      return {
        currency,
        income: dto(inMinor, currency),
        expense: dto(outMinor, currency),
        net: dto(inMinor - outMinor, currency),
      };
    });
};
