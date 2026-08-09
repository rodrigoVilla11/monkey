import { addDays, differenceInDays, type CalendarDate } from "./dates";
import { divideRoundHalfUp } from "./money";
import { planProgress } from "./plan";
import type { RecurrenceFrequency } from "./recurrence";

/**
 * Deudas: saldo, avance y proyección. Lógica pura, sin base de datos.
 *
 * ── La decisión que define el módulo: registra, NO amortiza ──────────────────
 *
 * monKey no calcula la cuota de un préstamo. Podría —la fórmula francesa son
 * cuatro líneas— y sería un error: los bancos usan convenciones de días
 * distintas, cobran comisiones, meten seguros y redondean a su manera. Una cuota
 * calculada acá se desviaría de la real, y un número que se desvía tres euros
 * del recibo es peor que no mostrar ninguno: invita a confiar en él.
 *
 * Lo que sí hace es lo que nadie más puede hacer por vos: llevar la cuenta de
 * lo que pagaste. El saldo es `original − pagos`, sin capitalizar intereses.
 * Es la misma decisión que ya estaba tomada en el esquema.
 *
 * ── Entonces, ¿para qué está `interestRateBps`? ─────────────────────────────
 *
 * Para decir cuánto CUESTA el saldo que falta: "a 12 % anual, los 5.000 € que
 * debés generan unos 50 € por mes". Eso es aritmética sobre el número que
 * escribió la persona, no una predicción sobre lo que hará su banco. La
 * diferencia es la que separa informar de inventar.
 *
 * Módulo puro: sin Next, sin Prisma, sin React.
 */

export type DebtDirection = "OWED_TO_ME" | "OWED_BY_ME";

export interface DebtBalance {
  /** Lo pagado hasta ahora. */
  readonly paidMinor: bigint;
  /** Lo que falta. Cero si ya se saldó (nunca negativo). */
  readonly remainingMinor: bigint;
  /** Cuánto se pagó de más. Cero si todavía falta. */
  readonly overpaidMinor: bigint;
  /** 0..100 con un decimal. */
  readonly percentage: number;
  readonly settled: boolean;
}

export const debtBalance = (
  originalMinor: bigint,
  paidMinor: bigint,
): DebtBalance => {
  const settled = paidMinor >= originalMinor;

  return {
    paidMinor,
    remainingMinor: settled ? 0n : originalMinor - paidMinor,
    overpaidMinor: settled ? paidMinor - originalMinor : 0n,
    percentage: percentagePaid(paidMinor, originalMinor),
    settled,
  };
};

const percentagePaid = (paidMinor: bigint, originalMinor: bigint): number => {
  if (originalMinor <= 0n) return 0;
  if (paidMinor <= 0n) return 0;
  if (paidMinor >= originalMinor) return 100;

  // ×1000 para conservar un decimal, con redondeo al más cercano.
  return Number((paidMinor * 1000n + originalMinor / 2n) / originalMinor) / 10;
};

// ─────────────────────────────── interés ─────────────────────────────────────

/**
 * Interés mensual que genera el saldo pendiente a la tasa indicada.
 *
 * Es una **estimación informativa**, no una cuota: dice cuánto cuesta tener esa
 * plata sin pagar, que es la pregunta que el número de la tasa puede responder
 * honestamente.
 *
 * Se usa interés simple mensual —tasa anual / 12— y no una capitalización:
 * componer requiere saber cada cuánto capitaliza el acreedor, que es
 * exactamente el dato que no tenemos.
 *
 * `null` si no hay tasa o si no queda saldo: no hay nada que costear.
 */
export const monthlyInterestCost = (
  remainingMinor: bigint,
  interestRateBps: number | null,
): bigint | null => {
  if (interestRateBps === null || interestRateBps <= 0) return null;
  if (remainingMinor <= 0n) return null;

  // bps = centésimas de punto porcentual: 1 % = 100 bps.
  // mensual = saldo × bps / (10.000 × 12)
  return divideRoundHalfUp(remainingMinor * BigInt(interestRateBps), 120_000n);
};

// ─────────────────────────── plan de pago/cobro ──────────────────────────────

/**
 * El acuerdo: cuánto y cada cuánto.
 *
 * No es una cuota calculada —eso sigue sin hacerse— sino lo que dos personas se
 * dijeron: "te pago 300 por mes desde el 5 de marzo". Todo lo que sale de acá
 * es aritmética sobre ese número y sobre los pagos que se registraron, nunca
 * una predicción sobre lo que va a hacer el deudor.
 *
 * Las fechas las calcula el motor de recurrencia, el mismo de los movimientos
 * programados: un plan mensual arrancado un 31 vuelve al 31 después de febrero
 * en vez de mudarse al 28 para siempre.
 */
export interface DebtPlan {
  readonly amountMinor: bigint;
  readonly frequency: RecurrenceFrequency;
  /** Cada cuántos períodos. Quincenal = WEEKLY cada 2. */
  readonly interval: number;
  readonly startDate: CalendarDate;
  /** Cuotas pactadas: topea el plan. `null` = hasta saldar. */
  readonly installmentsTotal: number | null;
}

export interface DebtPlanProgress {
  /** Fechas del plan que ya pasaron, hoy incluido. */
  readonly dueCount: number;
  /**
   * Cuántas cuotas faltan para saldarla, al importe pactado.
   *
   * Sale del SALDO, no de contar pagos: si alguien adelantó tres cuotas de una,
   * faltan tres menos aunque haya hecho un solo pago. La última puede ser más
   * chica —es lo que sobra— y por eso se redondea para arriba.
   */
  readonly remainingInstallments: number;
  /** Lo que tendría que estar cobrado a hoy. Nunca más que el total. */
  readonly expectedToDateMinor: bigint;
  /** Lo que falta de lo YA vencido. Cero si está al día. */
  readonly behindMinor: bigint;
  /** La próxima fecha del plan, o `null` si ya no quedan. */
  readonly nextDate: CalendarDate | null;
  /** Cuándo quedaría saldada si el plan se cumple. */
  readonly payoffDate: CalendarDate | null;
  /**
   * Si el plan alcanza a cubrir la deuda. `false` cuando las cuotas pactadas se
   * quedan cortas —10 de 100 para una deuda de 5.000— y hay que decirlo: es un
   * acuerdo que no cierra, y descubrirlo en la última cuota es tarde.
   */
  readonly coversDebt: boolean;
}

/**
 * La cuenta la hace `shared/plan.ts`, que comparten las metas de ahorro:
 * apartar 96 por semana para una bici y cobrar 300 por mes de un préstamo son
 * el mismo problema con otro sustantivo.
 *
 * Lo que queda acá es el vocabulario de las deudas —`payoffDate`,
 * `coversDebt`—, porque una deuda se salda y una meta se alcanza, y llamarlas
 * igual haría que ninguna de las dos pantallas se leyera bien.
 */
export const debtPlanProgress = (options: {
  readonly plan: DebtPlan;
  readonly originalMinor: bigint;
  readonly paidMinor: bigint;
  readonly today: CalendarDate;
}): DebtPlanProgress => {
  const progress = planProgress({
    plan: {
      ...options.plan,
      maxInstallments: options.plan.installmentsTotal,
    },
    totalMinor: options.originalMinor,
    coveredMinor: options.paidMinor,
    today: options.today,
  });

  return {
    dueCount: progress.dueCount,
    remainingInstallments: progress.remainingInstallments,
    expectedToDateMinor: progress.expectedToDateMinor,
    behindMinor: progress.behindMinor,
    nextDate: progress.nextDate,
    payoffDate: progress.completionDate,
    coversDebt: progress.coversTotal,
  };
};

// ────────────────────────────── proyección ───────────────────────────────────

export type DebtStatus = "SETTLED" | "ON_TRACK" | "BEHIND" | "OVERDUE";

export interface DebtForecast {
  readonly status: DebtStatus;
  /** Días hasta el vencimiento. Negativo si ya pasó. */
  readonly daysRemaining: number | null;
  /** Cuánto habría que pagar por mes para llegar al vencimiento. */
  readonly requiredPerMonthMinor: bigint | null;
  /** Ritmo real desde el primer pago. */
  readonly actualPerMonthMinor: bigint | null;
  /** Cuándo quedaría saldada al ritmo actual. */
  readonly projectedDate: CalendarDate | null;
}

/**
 * Proyección de una deuda.
 *
 * Misma maquinaria que las metas de ahorro y por el mismo motivo: sin esto, la
 * fecha de vencimiento es decoración. Responde "¿cuánto tengo que pagar por
 * mes?" y "al ritmo que llevo, ¿llego?".
 */
export const debtForecast = (options: {
  readonly remainingMinor: bigint;
  readonly paidMinor: bigint;
  readonly dueDate: CalendarDate | null;
  /** Fecha del primer pago. Sin ella no hay ritmo que medir. */
  readonly firstPaymentDate: CalendarDate | null;
  readonly today: CalendarDate;
  /**
   * Progreso del plan pactado, si hay uno. Manda sobre el ritmo estimado: el
   * plan es lo que dos personas acordaron y el ritmo es una extrapolación
   * nuestra. Cuando discrepan, gana el acuerdo.
   */
  readonly plan?: DebtPlanProgress | null;
}): DebtForecast => {
  const { remainingMinor, dueDate, today, plan } = options;

  const behindOnPlan = plan != null && plan.behindMinor > 0n;

  const actualPerMonthMinor = paceOf(
    options.paidMinor,
    options.firstPaymentDate,
    today,
  );

  if (remainingMinor <= 0n) {
    return {
      status: "SETTLED",
      daysRemaining: dueDate === null ? null : differenceInDays(today, dueDate),
      requiredPerMonthMinor: null,
      actualPerMonthMinor,
      projectedDate: null,
    };
  }

  const projectedDate = projectPayoff(
    remainingMinor,
    actualPerMonthMinor,
    today,
  );

  if (dueDate === null) {
    /**
     * Sin vencimiento la deuda simplemente baja... salvo que haya un plan. Ahí
     * sí hay contra qué estar atrasado, y es justamente el caso de la plata que
     * te deben sin fecha de corte pero con un "te pago 300 por mes".
     */
    return {
      status: behindOnPlan ? "BEHIND" : "ON_TRACK",
      daysRemaining: null,
      requiredPerMonthMinor: null,
      actualPerMonthMinor,
      projectedDate,
    };
  }

  const daysRemaining = differenceInDays(today, dueDate);

  if (daysRemaining < 0) {
    return {
      status: "OVERDUE",
      daysRemaining,
      requiredPerMonthMinor: null,
      actualPerMonthMinor,
      projectedDate,
    };
  }

  /**
   * 30,44 días por mes (365,25/12). El `max(1)` evita dividir por cero el día
   * del vencimiento: si vence hoy, lo que falta hace falta hoy.
   */
  const monthsRemaining = Math.max(1, Math.round((daysRemaining * 100) / 3044));
  const requiredPerMonthMinor = divideRoundHalfUp(
    remainingMinor,
    BigInt(monthsRemaining),
  );

  return {
    /**
     * Sin ritmo medible todavía no se puede decir que vaya atrasada: hace menos
     * de una semana que arrancó. Se la deja en verde en vez de alarmar a
     * alguien que anotó la deuda ayer. El plan es la excepción: ahí no se
     * estima nada, se compara contra fechas que ya pasaron.
     */
    status:
      behindOnPlan ||
      (actualPerMonthMinor !== null &&
        actualPerMonthMinor < requiredPerMonthMinor)
        ? "BEHIND"
        : "ON_TRACK",
    daysRemaining,
    requiredPerMonthMinor,
    actualPerMonthMinor,
    projectedDate,
  };
};

/** Ritmo mensual real desde el primer pago. */
const paceOf = (
  paidMinor: bigint,
  firstPaymentDate: CalendarDate | null,
  today: CalendarDate,
): bigint | null => {
  if (firstPaymentDate === null || paidMinor <= 0n) return null;

  const days = differenceInDays(firstPaymentDate, today);
  // Con menos de una semana de historia, extrapolar a meses es ruido.
  if (days < 7) return null;

  return divideRoundHalfUp(paidMinor * 3044n, BigInt(days) * 100n);
};

/**
 * Cuándo quedaría saldada al ritmo actual.
 *
 * `null` si no hay ritmo o si la proyección se va más de diez años: a esa
 * distancia el número no informa nada.
 */
const projectPayoff = (
  remainingMinor: bigint,
  perMonthMinor: bigint | null,
  today: CalendarDate,
): CalendarDate | null => {
  if (perMonthMinor === null || perMonthMinor <= 0n) return null;

  const days = divideRoundHalfUp(remainingMinor * 3044n, perMonthMinor * 100n);
  if (days > 3650n) return null;

  return addDays(today, Number(days));
};

// ─────────────────────────────── cuotas ──────────────────────────────────────

/**
 * En qué cuota va, si la deuda se pactó en cuotas.
 *
 * Se cuentan los PAGOS registrados, no se deduce del importe: pagar de más un
 * mes no adelanta una cuota, y pagar de menos no la atrasa. La cuota es un
 * hecho del acuerdo, no una división.
 */
export const installmentProgress = (
  paymentCount: number,
  installmentsTotal: number | null,
): { readonly paid: number; readonly total: number } | null => {
  if (installmentsTotal === null || installmentsTotal <= 0) return null;
  return {
    paid: Math.min(paymentCount, installmentsTotal),
    total: installmentsTotal,
  };
};

// ──────────────────────────── patrimonio neto ────────────────────────────────

export interface NetPosition {
  /** Suma de saldos de cuentas. Es lo que muestran hoy los reportes. */
  readonly accountsMinor: bigint;
  /** Lo que falta cobrar. Suma. */
  readonly receivableMinor: bigint;
  /** Lo que falta pagar. Resta. */
  readonly payableMinor: bigint;
  /** accounts + receivable − payable. */
  readonly netMinor: bigint;
}

/**
 * Patrimonio neto con las deudas incluidas.
 *
 * Vive aparte y NO se mete en la curva de patrimonio de los reportes a
 * propósito. Esa curva es "saldo de cuentas" —una posición de caja— y meterle
 * deudas redefiniría en silencio lo que significan todos los reportes ya
 * existentes. Acá se dice explícitamente qué se está sumando y qué se resta.
 *
 * Que la distinción importa se ve con un préstamo recién recibido: los 10.000 €
 * están en la cuenta, así que el saldo sube, pero el patrimonio neto no se
 * movió. Las dos cifras son ciertas y responden preguntas distintas.
 */
export const netPosition = (
  accountsMinor: bigint,
  receivableMinor: bigint,
  payableMinor: bigint,
): NetPosition => ({
  accountsMinor,
  receivableMinor,
  payableMinor,
  netMinor: accountsMinor + receivableMinor - payableMinor,
});
