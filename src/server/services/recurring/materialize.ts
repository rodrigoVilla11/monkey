import type { Logger } from "pino";

import { systemClient } from "@/server/db/system";
import { getRateProvider } from "@/server/services/rates";
import type { MaterializationReport } from "@/shared/contracts/recurring";
import {
  fromCalendarDate,
  toCalendarDate,
  todayIn,
  type CalendarDate,
} from "@/shared/dates";
import { convert, money } from "@/shared/money";
import { occurrencesUpTo } from "@/shared/recurrence";

import { specOf } from "./index";

/**
 * Job de materialización: convierte reglas vencidas en transacciones.
 *
 * ── La decisión de fondo: qué pasa si el job estuvo caído ────────────────────
 *
 * **Se materializan TODAS las ocurrencias vencidas, cada una con SU fecha.**
 * Si el alquiler vencía el 1 y el job recién corre el 20, la transacción se
 * fecha el 1. Las otras dos opciones son peores y no por poco:
 *
 *  · Saltear al futuro perdería un gasto que sí salió de la cuenta.
 *  · Materializar una sola fechada hoy metería el alquiler de enero en el mes
 *    de marzo, y todos los reportes mensuales pasarían a mentir.
 *
 * La fecha es un hecho económico, no la hora a la que corrió un proceso.
 *
 * ── Los tres frenos ─────────────────────────────────────────────────────────
 *
 * 1. **Tope por regla y corrida** (`MAX_OCCURRENCES_PER_RUN`). Una regla diaria
 *    caída seis meses generaría 180 filas de un saque. Se materializan las
 *    primeras y el resto queda para la corrida siguiente: nunca se saltea nada,
 *    solo se reparte. Queda en el reporte y en el log.
 *
 * 2. **Idempotencia en la base.** Un unique parcial sobre
 *    (spaceId, recurringRuleId, date) impide que dos disparos del cron —un
 *    reintento, dos instancias— dupliquen el mismo mes.
 *
 * 3. **Una transacción de base por regla.** Si una regla falla, se cuenta y el
 *    job sigue con las demás. Un fallo aislado no puede dejar sin ejecutar a
 *    todos los Spaces.
 *
 * ── Por qué NO usa el cliente scopeado ──────────────────────────────────────
 *
 * Es el único proceso del sistema que cruza Spaces a propósito: barre las
 * reglas vencidas de todos. Por eso va con `systemClient()` y por eso cada
 * consulta lleva su `spaceId` explícito, igual que el SQL crudo de reportes.
 */

/**
 * Tope de ocurrencias por regla y por corrida.
 *
 * 60 cubre dos meses de una regla diaria y años de una mensual. Más alto haría
 * que una corrida de recuperación escribiera miles de filas en una sola
 * transacción; más bajo alargaría la recuperación varios días.
 */
const MAX_OCCURRENCES_PER_RUN = 60;

/** Cuántas reglas se traen por vuelta. El job pagina hasta que no queda ninguna. */
const RULE_BATCH_SIZE = 100;

export interface MaterializeOptions {
  /**
   * Hasta qué fecha se materializa. Por defecto "hoy" en UTC.
   *
   * Es UTC y no la timezone de cada Space a propósito: la diferencia es como
   * mucho un día, y ese día lo corrige la corrida siguiente. Resolver la
   * timezone de cada Space obligaría a agrupar el barrido por huso y a que el
   * cron corriera 24 veces para cubrirlos todos.
   */
  readonly until?: CalendarDate;
  /** Acota el barrido a un Space. Lo usa el barrido oportunista del dashboard. */
  readonly spaceId?: string;
  /** Acota el barrido a UNA regla. Lo usa el "Aceptar" manual de Programados. */
  readonly ruleId?: string;
  /**
   * Fuerza que las ocurrencias nazcan CLEARED aunque la regla no tenga
   * `autoPost`. Es para el "Aceptar" explícito: quien tocó el botón ya revisó,
   * y hacerlas nacer pendientes lo obligaría a confirmar lo mismo dos veces.
   */
  readonly post?: boolean;
  readonly logger?: Logger;
}

interface RuleRow {
  id: string;
  spaceId: string;
  accountId: string;
  categoryId: string | null;
  createdByUserId: string | null;
  createdByName: string;
  type: string;
  amountMinor: bigint;
  currency: string;
  description: string | null;
  payee: string | null;
  frequency: string;
  interval: number;
  byMonthDay: number | null;
  byWeekday: number | null;
  byMonth: number | null;
  startDate: Date;
  endDate: Date | null;
  maxOccurrences: number | null;
  nextRunDate: Date;
  occurrencesCreated: number;
  autoPost: boolean;
}

const RULE_SELECT = {
  id: true,
  spaceId: true,
  accountId: true,
  categoryId: true,
  createdByUserId: true,
  createdByName: true,
  type: true,
  amountMinor: true,
  currency: true,
  description: true,
  payee: true,
  frequency: true,
  interval: true,
  byMonthDay: true,
  byWeekday: true,
  byMonth: true,
  startDate: true,
  endDate: true,
  maxOccurrences: true,
  nextRunDate: true,
  occurrencesCreated: true,
  autoPost: true,
} as const;

export const materializeDueRules = async (
  options: MaterializeOptions = {},
): Promise<MaterializationReport> => {
  const db = systemClient();
  const until = options.until ?? todayIn("UTC");
  const logger = options.logger;

  let rulesExamined = 0;
  let rulesAdvanced = 0;
  let transactionsCreated = 0;
  let rulesTruncated = 0;
  let rulesCompleted = 0;
  let rulesFailed = 0;

  /**
   * Se pagina por id y no por offset: el job va modificando `nextRunDate` de
   * las reglas que procesa, así que el conjunto cambia bajo los pies y un
   * offset se saltearía filas.
   */
  let cursor: string | undefined;

  for (;;) {
    const rules: RuleRow[] = await db.recurringRule.findMany({
      where: {
        isActive: true,
        deletedAt: null,
        nextRunDate: { lte: fromCalendarDate(until) },
        ...(options.spaceId !== undefined ? { spaceId: options.spaceId } : {}),
        ...(options.ruleId !== undefined ? { id: options.ruleId } : {}),
        ...(cursor !== undefined ? { id: { gt: cursor } } : {}),
      },
      orderBy: { id: "asc" },
      take: RULE_BATCH_SIZE,
      select: RULE_SELECT,
    });

    if (rules.length === 0) break;
    cursor = rules.at(-1)?.id;

    for (const rule of rules) {
      rulesExamined += 1;

      try {
        const result = await materializeRule(rule, until, options.post);

        transactionsCreated += result.created;
        if (result.created > 0) rulesAdvanced += 1;
        if (result.truncated) rulesTruncated += 1;
        if (result.completed) rulesCompleted += 1;

        if (result.truncated) {
          logger?.warn(
            {
              spaceId: rule.spaceId,
              recurringRuleId: rule.id,
              created: result.created,
            },
            "regla con atraso pendiente: sigue en la próxima corrida",
          );
        }
      } catch (error) {
        rulesFailed += 1;
        // Sin el importe ni la descripción: en el log no van datos financieros.
        logger?.error(
          {
            spaceId: rule.spaceId,
            recurringRuleId: rule.id,
            err: error instanceof Error ? error.message : "desconocido",
          },
          "no se pudo materializar una regla",
        );
      }
    }
  }

  return {
    until,
    rulesExamined,
    rulesAdvanced,
    transactionsCreated,
    rulesTruncated,
    rulesCompleted,
    rulesFailed,
  };
};

interface RuleResult {
  readonly created: number;
  readonly truncated: boolean;
  readonly completed: boolean;
}

/**
 * Materializa una regla. Todo dentro de una transacción de base: las
 * transacciones y el avance de la regla se guardan juntos o no se guarda nada.
 *
 * Si se guardaran por separado y el proceso muriera en el medio, la regla
 * quedaría sin avanzar y la corrida siguiente volvería a intentar las mismas
 * fechas. El unique parcial las rechazaría —o sea, no se duplicarían— pero la
 * regla quedaría trabada para siempre.
 */
const materializeRule = async (
  rule: RuleRow,
  until: CalendarDate,
  post?: boolean,
): Promise<RuleResult> => {
  const spec = specOf(rule);
  const window = occurrencesUpTo(
    spec,
    toCalendarDate(rule.nextRunDate),
    until,
    remainingBudget(rule),
  );

  if (window.dates.length === 0) {
    // No hay nada vencido, pero la regla puede haber terminado (endDate en el
    // pasado). Se desactiva para que deje de aparecer en el barrido.
    if (window.next === null) {
      await systemClient().recurringRule.update({
        where: { id: rule.id },
        data: { isActive: false, lastRunAt: new Date() },
      });
      return { created: 0, truncated: false, completed: true };
    }
    return { created: 0, truncated: false, completed: false };
  }

  const space = await systemClient().space.findUniqueOrThrow({
    where: { id: rule.spaceId },
    select: { primaryCurrency: true },
  });

  // La conversión se resuelve ANTES de abrir la transacción: consultar
  // cotizaciones adentro alargaría el lock por cada ocurrencia.
  const rows = await Promise.all(
    window.dates.map(async (date) => ({
      date,
      conversion: await resolveConversion(rule, space.primaryCurrency, date),
    })),
  );

  await systemClient().$transaction(async (tx) => {
    await tx.transaction.createMany({
      data: rows.map(({ date, conversion }) => ({
        spaceId: rule.spaceId,
        accountId: rule.accountId,
        categoryId: rule.categoryId,
        createdByUserId: rule.createdByUserId,
        createdByName: rule.createdByName,
        recurringRuleId: rule.id,
        type: rule.type as "INCOME" | "EXPENSE",
        // `autoPost` decide si nace dada por buena o a revisar, salvo que el
        // disparo venga de un "Aceptar" explícito (`post`).
        status:
          (post ?? rule.autoPost) ? ("CLEARED" as const) : ("PENDING" as const),
        amountMinor: rule.amountMinor,
        currency: rule.currency,
        date: fromCalendarDate(date),
        description: rule.description,
        payee: rule.payee,
        ...(conversion !== null
          ? {
              exchangeRateSnapshot: conversion.rate,
              amountPrimaryMinor: conversion.amountPrimaryMinor,
            }
          : {}),
      })),
      // Si un disparo anterior ya creó alguna de estas fechas, se ignora en vez
      // de reventar la corrida entera. El unique parcial es quien lo detecta.
      skipDuplicates: true,
    });

    await tx.recurringRule.update({
      where: { id: rule.id },
      data: {
        occurrencesCreated: rule.occurrencesCreated + window.dates.length,
        lastRunAt: new Date(),
        ...(window.next === null
          ? { isActive: false }
          : { nextRunDate: fromCalendarDate(window.next) }),
      },
    });
  });

  return {
    created: window.dates.length,
    truncated: window.truncated,
    completed: window.next === null,
  };
};

/**
 * Cuántas ocurrencias puede generar esta regla en esta corrida.
 *
 * Es el tope, recortado además por lo que le quede de `maxOccurrences`: sin
 * esto, una regla con tope 3 y tres años de atraso generaría 36 y recién
 * después se daría cuenta.
 */
const remainingBudget = (rule: RuleRow): number => {
  if (rule.maxOccurrences === null) return MAX_OCCURRENCES_PER_RUN;
  return Math.min(
    MAX_OCCURRENCES_PER_RUN,
    Math.max(0, rule.maxOccurrences - rule.occurrencesCreated),
  );
};

/**
 * Conversión a la moneda primaria del Space, congelada por ocurrencia.
 *
 * Se busca la cotización de CADA fecha, no la de hoy: al recuperar un atraso,
 * el gasto de enero tiene que quedar con la cotización de enero. Es la misma
 * regla que en las transacciones manuales.
 *
 * Si no hay cotización para esa fecha se tira: la regla queda sin materializar
 * y se cuenta como fallo. La alternativa —usar la de hoy en silencio— pondría
 * un número inventado en un reporte histórico.
 */
const resolveConversion = async (
  rule: RuleRow,
  primaryCurrency: string,
  date: CalendarDate,
): Promise<{ rate: string; amountPrimaryMinor: bigint } | null> => {
  if (rule.currency === primaryCurrency) return null;

  const found = await getRateProvider().find(
    rule.currency,
    primaryCurrency,
    date,
  );

  if (found === null) {
    throw new Error(
      `sin cotización de ${rule.currency} a ${primaryCurrency} para ${date}`,
    );
  }

  const converted = convert(
    money(rule.amountMinor, rule.currency),
    found.rate,
    primaryCurrency,
  );

  if (!converted.ok) throw new Error("cotización inválida");

  return { rate: found.rate, amountPrimaryMinor: converted.value.amountMinor };
};
