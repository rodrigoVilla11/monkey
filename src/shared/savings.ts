import { addDays, differenceInDays, type CalendarDate } from "./dates";
import { divideRoundHalfUp } from "./money";

/**
 * Metas de ahorro: progreso y proyección. Lógica pura, sin base de datos.
 *
 * ── Lo que una meta NO es ────────────────────────────────────────────────────
 *
 * **Ahorrar no es gastar.** Apartar 200 € no baja el patrimonio: la plata sigue
 * siendo tuya, solo cambió de bolsillo. Por eso un aporte nunca genera un gasto:
 * o se vincula a un movimiento que ya existe —típicamente una transferencia a la
 * cuenta de ahorro— o es puro registro. Si generara un EXPENSE, el mes en que
 * ahorrás aparecería como el mes en que más gastaste.
 *
 * ── Por qué el progreso son los aportes y no el saldo de la cuenta ──────────
 *
 * Sería tentador atar la meta a una cuenta y usar su saldo. Se rompe apenas esa
 * cuenta se usa para otra cosa, y con dos metas sobre la misma cuenta las dos
 * mostrarían el total. Los aportes son explícitos: dicen cuánto de ese saldo es
 * para esto.
 *
 * Módulo puro: sin Next, sin Prisma, sin React.
 */

export interface GoalProgress {
  readonly savedMinor: bigint;
  /** Lo que falta. Cero si ya se llegó (nunca negativo). */
  readonly remainingMinor: bigint;
  /** Cuánto se pasó del objetivo. Cero si todavía no se llegó. */
  readonly surplusMinor: bigint;
  /** 0..100, con un decimal. Se corta en 100 aunque se haya pasado. */
  readonly percentage: number;
  readonly achieved: boolean;
}

export const goalProgress = (
  savedMinor: bigint,
  targetMinor: bigint,
): GoalProgress => {
  const achieved = savedMinor >= targetMinor;

  return {
    savedMinor,
    remainingMinor: achieved ? 0n : targetMinor - savedMinor,
    surplusMinor: achieved ? savedMinor - targetMinor : 0n,
    percentage: percentageOfTarget(savedMinor, targetMinor),
    achieved,
  };
};

/**
 * Porcentaje alcanzado, con un decimal y acotado a [0, 100].
 *
 * Se acota arriba porque la barra no puede pasarse del contenedor, y abajo
 * porque un saldo negativo —se retiró más de lo aportado— no es "−30 % de la
 * meta": es cero.
 */
const percentageOfTarget = (
  savedMinor: bigint,
  targetMinor: bigint,
): number => {
  if (targetMinor <= 0n) return 0;
  if (savedMinor <= 0n) return 0;
  if (savedMinor >= targetMinor) return 100;

  // ×1000 para conservar un decimal, con redondeo al más cercano.
  return Number((savedMinor * 1000n + targetMinor / 2n) / targetMinor) / 10;
};

// ────────────────────────────── proyección ───────────────────────────────────

export type GoalPace = "ON_TRACK" | "BEHIND" | "ACHIEVED" | "OVERDUE";

export interface GoalForecast {
  /** Cuánto habría que apartar por mes para llegar a tiempo. */
  readonly requiredPerMonthMinor: bigint | null;
  /** Ritmo real desde el primer aporte, por mes. */
  readonly actualPerMonthMinor: bigint | null;
  /** Fecha estimada de llegada al ritmo actual. */
  readonly projectedDate: CalendarDate | null;
  readonly pace: GoalPace;
  readonly daysRemaining: number | null;
}

/**
 * Proyección de una meta con fecha objetivo.
 *
 * Es lo único que hace útil poner una fecha: sin esto, la fecha es decoración.
 * Responde "¿cuánto tengo que apartar por mes?" y "al ritmo que llevo, ¿llego?".
 *
 * Sin `targetDate` no hay nada que proyectar y devuelve todo en null: una meta
 * sin plazo no puede ir atrasada.
 */
export const goalForecast = (options: {
  readonly savedMinor: bigint;
  readonly targetMinor: bigint;
  readonly targetDate: CalendarDate | null;
  /** Fecha del primer aporte. Sin ella no hay ritmo que medir. */
  readonly firstContributionDate: CalendarDate | null;
  readonly today: CalendarDate;
}): GoalForecast => {
  const { savedMinor, targetMinor, targetDate, today } = options;
  const remaining = savedMinor >= targetMinor ? 0n : targetMinor - savedMinor;

  const actualPerMonthMinor = paceOf(
    savedMinor,
    options.firstContributionDate,
    today,
  );

  if (savedMinor >= targetMinor) {
    return {
      requiredPerMonthMinor: null,
      actualPerMonthMinor,
      projectedDate: null,
      pace: "ACHIEVED",
      daysRemaining:
        targetDate === null ? null : differenceInDays(today, targetDate),
    };
  }

  if (targetDate === null) {
    return {
      requiredPerMonthMinor: null,
      actualPerMonthMinor,
      projectedDate: null,
      // Sin plazo no se puede estar atrasado. La meta simplemente avanza.
      pace: "ON_TRACK",
      daysRemaining: null,
    };
  }

  const daysRemaining = differenceInDays(today, targetDate);

  if (daysRemaining < 0) {
    return {
      requiredPerMonthMinor: null,
      actualPerMonthMinor,
      projectedDate: null,
      pace: "OVERDUE",
      daysRemaining,
    };
  }

  /**
   * Se divide por meses y no por días porque el ahorro es mensual en la cabeza
   * de cualquiera. Se usa 30,44 (365,25/12) como largo del mes: dividir por 30
   * exagera lo que hace falta casi un 1,5 %.
   *
   * El `max(1)` evita dividir por cero el día del vencimiento: si vence hoy,
   * lo que falta hace falta hoy.
   */
  const monthsRemaining = Math.max(1, Math.round((daysRemaining * 100) / 3044));
  const requiredPerMonthMinor = divideRoundHalfUp(
    remaining,
    BigInt(monthsRemaining),
  );

  return {
    requiredPerMonthMinor,
    actualPerMonthMinor,
    projectedDate: projectArrival(remaining, actualPerMonthMinor, today),
    /**
     * Sin ritmo medible todavía no se puede decir que vaya atrasada: hace
     * menos de una semana que arrancó. Se la deja en verde en vez de asustar
     * a alguien que puso la meta ayer.
     */
    pace:
      actualPerMonthMinor === null ||
      actualPerMonthMinor >= requiredPerMonthMinor
        ? "ON_TRACK"
        : "BEHIND",
    daysRemaining,
  };
};

/**
 * Cuándo se llegaría al ritmo actual.
 *
 * `null` si no hay ritmo o si la proyección se va más de diez años: a esa
 * distancia el número no informa nada y solo ocupa lugar en la pantalla.
 */
const projectArrival = (
  remainingMinor: bigint,
  perMonthMinor: bigint | null,
  today: CalendarDate,
): CalendarDate | null => {
  if (perMonthMinor === null || perMonthMinor <= 0n) return null;

  // días = restante / (porMes / 30,44)
  const days = divideRoundHalfUp(remainingMinor * 3044n, perMonthMinor * 100n);
  if (days > 3650n) return null;

  return addDays(today, Number(days));
};

/**
 * Ritmo mensual real desde el primer aporte.
 *
 * `null` si todavía no hay aportes o si el primero fue hoy: con un solo día de
 * historia, cualquier extrapolación a meses es ruido. Mejor no decir nada que
 * decir que a este ritmo llegás en tres días.
 */
const paceOf = (
  savedMinor: bigint,
  firstContributionDate: CalendarDate | null,
  today: CalendarDate,
): bigint | null => {
  if (firstContributionDate === null || savedMinor <= 0n) return null;

  const days = differenceInDays(firstContributionDate, today);
  if (days < 7) return null;

  return divideRoundHalfUp(savedMinor * 3044n, BigInt(days) * 100n);
};
