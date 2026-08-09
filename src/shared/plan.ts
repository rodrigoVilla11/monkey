import type { CalendarDate } from "./dates";
import {
  occurrenceAt,
  occurrencesUpTo,
  type RecurrenceFrequency,
  type RecurrenceSpec,
} from "./recurrence";

/**
 * Un plan de cuotas contra un total: cuánto y cada cuánto.
 *
 * Lo usan las deudas —"te pago 300 por mes"— y las metas —"aparto 96 por
 * semana"—. Es la misma aritmética con dos vocabularios, y vive en un solo
 * lugar por el mismo motivo que el signo de un movimiento: dos copias de la
 * regla es la forma más fácil de que dos pantallas empiecen a decir cosas
 * distintas sobre el mismo hecho.
 *
 * Lo que este módulo NO hace es inventar el plan. El importe y la periodicidad
 * los pone quien los pactó; acá solo se cuenta cuántas fechas pasaron, cuánto
 * tendría que haber entrado y cuánto falta.
 *
 * Las fechas las calcula el motor de recurrencia, el mismo de los movimientos
 * programados: un plan mensual arrancado un 31 vuelve al 31 después de febrero
 * en vez de mudarse al 28 para siempre.
 *
 * Módulo puro: sin Next, sin Prisma, sin React.
 */

export interface InstallmentPlan {
  readonly amountMinor: bigint;
  readonly frequency: RecurrenceFrequency;
  /** Cada cuántos períodos. Quincenal = WEEKLY cada 2. */
  readonly interval: number;
  readonly startDate: CalendarDate;
  /** Tope de cuotas pactadas. `null` = las que hagan falta. */
  readonly maxInstallments: number | null;
}

export interface PlanProgress {
  /** Fechas del plan que ya pasaron, hoy incluido. */
  readonly dueCount: number;
  /**
   * Cuántas cuotas faltan para cubrir el total, al importe pactado.
   *
   * Sale del SALDO, no de contar movimientos: si alguien adelantó tres cuotas
   * de una, faltan tres menos aunque haya hecho un solo pago. La última puede
   * ser más chica —es lo que sobra— y por eso se redondea para arriba.
   */
  readonly remainingInstallments: number;
  /** Lo que tendría que estar cubierto a hoy. Nunca más que el total. */
  readonly expectedToDateMinor: bigint;
  /** Lo que falta de lo YA vencido. Cero si está al día. */
  readonly behindMinor: bigint;
  /** La próxima fecha del plan, o `null` si ya no quedan. */
  readonly nextDate: CalendarDate | null;
  /** Cuándo se terminaría de cubrir si el plan se cumple. */
  readonly completionDate: CalendarDate | null;
  /**
   * Si el plan alcanza a cubrir el total. `false` cuando las cuotas pactadas se
   * quedan cortas —10 de 100 para una deuda de 5.000— y hay que decirlo: es un
   * acuerdo que no cierra, y descubrirlo en la última cuota es tarde.
   */
  readonly coversTotal: boolean;
}

/**
 * Tope duro de fechas a recorrer, el mismo que acepta `installmentsTotal`.
 *
 * No es una preferencia estética: sin él, un plan de 1 centavo por día contra
 * un total de 50.000 pediría cinco millones de iteraciones. Más allá de 600 el
 * plan directamente no cubre el total, que es lo único que hace falta
 * responder.
 */
export const PLAN_HORIZON = 600;

export const planProgress = (options: {
  readonly plan: InstallmentPlan;
  readonly totalMinor: bigint;
  /** Lo que ya se pagó o se aportó. */
  readonly coveredMinor: bigint;
  readonly today: CalendarDate;
}): PlanProgress => {
  const { plan, totalMinor, coveredMinor, today } = options;

  /**
   * Cuántas cuotas hacen falta, redondeando para ARRIBA: la última es la que
   * queda corta. Con 1.000 en cuotas de 300 son cuatro fechas —300, 300, 300 y
   * 100—, no tres y monedas.
   */
  const needed = Number(
    (totalMinor + plan.amountMinor - 1n) / plan.amountMinor,
  );
  const pactadas = plan.maxInstallments ?? PLAN_HORIZON;
  const coversTotal = needed <= pactadas && needed <= PLAN_HORIZON;
  const total = Math.min(needed, pactadas, PLAN_HORIZON);

  const spec: RecurrenceSpec = {
    frequency: plan.frequency,
    interval: plan.interval,
    startDate: plan.startDate,
    maxOccurrences: total,
  };

  const window = occurrencesUpTo(spec, plan.startDate, today, total);
  const dueCount = window.dates.length;

  /**
   * Lo esperado se topea con el total: si el plan pactó doce cuotas de 300 para
   * una deuda de 3.000, la última es de 300 pero solo se deben 3.000. Cubrir
   * "de más" según el plan no es estar adelantado, es haber terminado.
   */
  const pending = plan.amountMinor * BigInt(dueCount);
  const expectedToDateMinor = pending > totalMinor ? totalMinor : pending;

  const behind = expectedToDateMinor - coveredMinor;
  const remainingMinor =
    totalMinor > coveredMinor ? totalMinor - coveredMinor : 0n;

  return {
    dueCount,
    remainingInstallments: Number(
      (remainingMinor + plan.amountMinor - 1n) / plan.amountMinor,
    ),
    expectedToDateMinor,
    behindMinor: behind > 0n ? behind : 0n,
    /**
     * La que sigue sale de la MISMA ventana que contó las vencidas, y no de
     * `nextOccurrence(spec, today)`: esa función deduce el índice por mes y
     * ordena la de julio cuando hoy es 4 de junio y la cuota es el 5. Sirve
     * para "la siguiente a la que ya corrió", que no es esta pregunta.
     */
    nextDate: coveredMinor >= totalMinor ? null : window.next,
    completionDate: coversTotal ? occurrenceAt(spec, total - 1) : null,
    coversTotal,
  };
};
