import { addDays, differenceInDays, type CalendarDate } from "./dates";
import { divideRoundHalfUp } from "./money";
import { planProgress, type InstallmentPlan } from "./plan";
import { occurrencesUpTo, type RecurrenceFrequency } from "./recurrence";

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

// ─────────────────────────── cómo llegar a la meta ───────────────────────────

/**
 * Una forma concreta de llegar: "16 aportes semanales de 156,25".
 *
 * No es un consejo financiero ni una predicción: es la misma división hecha
 * con distintos calendarios, para que elegir sea mirar cuál entra en el
 * bolsillo y no hacer la cuenta a mano. Por eso cada opción viene con cuántas
 * veces y cuándo termina — un número por semana sin saber cuántas semanas no
 * dice nada.
 */
export interface GoalPlanOption {
  readonly frequency: RecurrenceFrequency;
  /** Cada cuántos períodos. Quincenal = WEEKLY cada 2. */
  readonly interval: number;
  /** Cuánto por vez. Redondeado ARRIBA: ver abajo. */
  readonly amountMinor: bigint;
  readonly count: number;
  /** Fecha del último aporte. Puede caer días antes del objetivo. */
  readonly lastDate: CalendarDate;
}

const CADENCES = [
  { frequency: "DAILY", interval: 1 },
  { frequency: "WEEKLY", interval: 1 },
  { frequency: "WEEKLY", interval: 2 },
  { frequency: "MONTHLY", interval: 1 },
] as const;

/**
 * Tope de fechas de una propuesta. Más allá no es una propuesta: es una lista.
 * ~2,7 años de aportes diarios.
 */
const OPTION_LIMIT = 1000;

/**
 * Las formas de llegar a la meta antes de la fecha.
 *
 * Vacío si no hay fecha objetivo, si ya se alcanzó o si la fecha ya pasó: en
 * los tres casos no hay nada que proponer, y proponer igual sería inventar un
 * plazo que nadie puso.
 *
 * El importe se redondea PARA ARRIBA. Con 2.500 en 16 semanas, 156,25 exacto;
 * con 2.500 en 3 meses, 833,34 y no 833,33 — la diferencia son dos centavos
 * que, redondeando para abajo, dejarían la meta sin cumplir el último día. Un
 * plan que no llega no es un plan.
 */
export const goalPlanOptions = (options: {
  readonly remainingMinor: bigint;
  readonly targetDate: CalendarDate | null;
  readonly today: CalendarDate;
}): readonly GoalPlanOption[] => {
  const { remainingMinor, targetDate, today } = options;

  if (remainingMinor <= 0n || targetDate === null || targetDate < today) {
    return [];
  }

  const result: GoalPlanOption[] = [];

  for (const cadence of CADENCES) {
    const window = occurrencesUpTo(
      { ...cadence, startDate: today },
      today,
      targetDate,
      OPTION_LIMIT,
    );

    if (window.truncated) continue;

    const count = window.dates.length;
    const lastDate = window.dates[count - 1];
    if (count === 0 || lastDate === undefined) continue;

    /**
     * Dos calendarios que dan el mismo número de aportes son la misma
     * propuesta escrita distinto: si a la meta le quedan cinco días, "una vez
     * por semana" y "una vez por mes" son las dos un único aporte de todo. Se
     * queda la primera, que es la de grano más fino.
     */
    if (result.some((option) => option.count === count)) continue;

    result.push({
      ...cadence,
      amountMinor: (remainingMinor + BigInt(count) - 1n) / BigInt(count),
      count,
      lastDate,
    });
  }

  return result;
};

// ──────────────────────── el plan elegido, y cómo va ─────────────────────────

/**
 * El plan que la persona eligió: apartar tanto, cada tanto, desde tal día.
 *
 * No lleva tope de aportes —a diferencia del de una deuda— porque una meta se
 * termina cuando se junta la plata, no cuando se cumple un número de cuotas
 * pactado con nadie.
 */
export interface GoalPlan {
  readonly amountMinor: bigint;
  readonly frequency: RecurrenceFrequency;
  readonly interval: number;
  readonly startDate: CalendarDate;
}

export interface GoalPlanProgress {
  /** Fechas del plan que ya pasaron, hoy incluido. */
  readonly dueCount: number;
  /** Cuántos aportes faltan, al importe elegido. Sale del saldo. */
  readonly remainingContributions: number;
  /** Lo que tendría que estar apartado a hoy. Nunca más que el objetivo. */
  readonly expectedToDateMinor: bigint;
  /** Lo que falta de lo que ya venció. Cero si está al día. */
  readonly behindMinor: bigint;
  readonly nextDate: CalendarDate | null;
  /** Cuándo se llegaría si el plan se cumple. */
  readonly arrivalDate: CalendarDate | null;
}

export const goalPlanProgress = (options: {
  readonly plan: GoalPlan;
  readonly targetMinor: bigint;
  readonly savedMinor: bigint;
  readonly today: CalendarDate;
}): GoalPlanProgress => {
  const plan: InstallmentPlan = { ...options.plan, maxInstallments: null };

  const progress = planProgress({
    plan,
    totalMinor: options.targetMinor,
    coveredMinor: options.savedMinor,
    today: options.today,
  });

  return {
    dueCount: progress.dueCount,
    remainingContributions: progress.remainingInstallments,
    expectedToDateMinor: progress.expectedToDateMinor,
    behindMinor: progress.behindMinor,
    nextDate: progress.nextDate,
    arrivalDate: progress.completionDate,
  };
};
