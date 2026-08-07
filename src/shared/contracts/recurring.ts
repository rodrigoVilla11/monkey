import { z } from "zod";

import { isCurrencyCode } from "../currency";
import { validateRecurrence } from "../recurrence";
import {
  amountMinorSchema,
  calendarDateSchema,
  cuidSchema,
  type MoneyDTO,
} from "./common";

/**
 * Reglas recurrentes: el alquiler, el sueldo, la cuota del gimnasio.
 *
 * Una regla NO es una transacción: es la instrucción de crearlas. Las
 * transacciones las materializa un job, y cada una queda apuntando a su regla
 * por `recurringRuleId`.
 *
 * Módulo puro: sin Next, sin Prisma, sin React.
 */

export const RECURRENCE_FREQUENCIES = [
  "DAILY",
  "WEEKLY",
  "MONTHLY",
  "YEARLY",
] as const;

const baseFields = {
  accountId: cuidSchema,
  categoryId: cuidSchema.nullable().optional(),
  /**
   * TRANSFER no: una regla no tiene cuenta de destino y generaría patas
   * sueltas. Un CHECK en la base lo respalda.
   */
  type: z.enum(["INCOME", "EXPENSE"]),
  amountMinor: amountMinorSchema.refine(
    // El guard de dígitos no sobra: Zod corre los refinements aunque el regex
    // base ya haya fallado, y `BigInt("1.5")` lanza un SyntaxError.
    (value) => /^\d+$/.test(value) && BigInt(value) > 0n,
    "El importe tiene que ser mayor que cero",
  ),
  currency: z
    .string()
    .refine(isCurrencyCode, "Código de moneda ISO 4217 inválido")
    .optional(),
  description: z.string().trim().max(200).nullable().optional(),
  payee: z.string().trim().max(120).nullable().optional(),

  frequency: z.enum(RECURRENCE_FREQUENCIES),
  interval: z.number().int().min(1).max(365).default(1),
  byMonthDay: z.number().int().min(1).max(31).nullable().optional(),
  byWeekday: z.number().int().min(0).max(6).nullable().optional(),
  byMonth: z.number().int().min(1).max(12).nullable().optional(),

  startDate: calendarDateSchema,
  endDate: calendarDateSchema.nullable().optional(),
  maxOccurrences: z.number().int().min(1).max(1000).nullable().optional(),

  /**
   * true  → las transacciones nacen CLEARED, como si ya hubieran pasado.
   * false → nacen PENDING, para revisarlas antes de darlas por buenas.
   *
   * El default es true porque el caso típico —el alquiler que se debita
   * solo— ya ocurrió cuando el job lo materializa.
   */
  autoPost: z.boolean().default(true),
  isActive: z.boolean().default(true),
};

/**
 * Las reglas de forma de la recurrencia se validan con la MISMA función que usa
 * el motor, no con una copia en Zod. Duplicarlas sería la forma más fácil de
 * que la API acepte una regla que el motor después no sabe calcular.
 *
 * En la edición no hace falta repetirlo: el service arma la regla resultante
 * mezclando lo que llega con lo que ya había y la valida ahí, que es el único
 * momento en que se la conoce entera.
 */
export const createRecurringRuleRequestSchema = z
  .object(baseFields)
  .superRefine((value, ctx) => {
    const errors = validateRecurrence({
      frequency: value.frequency,
      interval: value.interval,
      startDate: value.startDate,
      endDate: value.endDate ?? null,
      maxOccurrences: value.maxOccurrences ?? null,
      byMonthDay: value.byMonthDay ?? null,
      byWeekday: value.byWeekday ?? null,
      byMonth: value.byMonth ?? null,
    });

    for (const message of errors) {
      ctx.addIssue({ code: "custom", message });
    }
  });

/**
 * Edición. `startDate` y `frequency` se pueden cambiar, pero eso reancla la
 * serie: las ocurrencias ya materializadas no se tocan —son hechos económicos
 * pasados— y `nextRunDate` se recalcula desde la regla nueva.
 */
export const updateRecurringRuleRequestSchema = z
  .object({
    accountId: cuidSchema.optional(),
    categoryId: cuidSchema.nullable().optional(),
    amountMinor: amountMinorSchema
      .refine(
        (value) => /^\d+$/.test(value) && BigInt(value) > 0n,
        "El importe tiene que ser mayor que cero",
      )
      .optional(),
    description: z.string().trim().max(200).nullable().optional(),
    payee: z.string().trim().max(120).nullable().optional(),
    frequency: z.enum(RECURRENCE_FREQUENCIES).optional(),
    interval: z.number().int().min(1).max(365).optional(),
    byMonthDay: z.number().int().min(1).max(31).nullable().optional(),
    byWeekday: z.number().int().min(0).max(6).nullable().optional(),
    byMonth: z.number().int().min(1).max(12).nullable().optional(),
    startDate: calendarDateSchema.optional(),
    endDate: calendarDateSchema.nullable().optional(),
    maxOccurrences: z.number().int().min(1).max(1000).nullable().optional(),
    autoPost: z.boolean().optional(),
    isActive: z.boolean().optional(),
  })
  .refine(
    (value) => Object.keys(value).length > 0,
    "Hay que mandar al menos un campo",
  );

export type CreateRecurringRuleRequest = z.infer<
  typeof createRecurringRuleRequestSchema
>;
export type UpdateRecurringRuleRequest = z.infer<
  typeof updateRecurringRuleRequestSchema
>;

export const recurringRuleFiltersSchema = z.object({
  /** Por defecto solo las activas: son las que le importan a quien mira. */
  includeInactive: z
    .union([z.boolean(), z.enum(["true", "false"])])
    .transform((v) => v === true || v === "true")
    .optional(),
});

export type RecurringRuleFilters = z.infer<typeof recurringRuleFiltersSchema>;

// ────────────────────────────── respuestas ───────────────────────────────────

export interface RecurringRuleDTO {
  readonly id: string;
  readonly type: "INCOME" | "EXPENSE";
  readonly amount: MoneyDTO;
  readonly description: string | null;
  readonly payee: string | null;
  readonly account: {
    readonly id: string;
    readonly name: string;
    readonly color: string | null;
    readonly icon: string | null;
  };
  readonly category: {
    readonly id: string;
    readonly name: string;
    readonly color: string | null;
    readonly icon: string | null;
  } | null;

  readonly frequency: (typeof RECURRENCE_FREQUENCIES)[number];
  readonly interval: number;
  readonly byMonthDay: number | null;
  readonly byWeekday: number | null;
  readonly byMonth: number | null;
  /** La regla en una línea, ya armada por el servidor. */
  readonly summary: string;

  readonly startDate: string;
  readonly endDate: string | null;
  readonly maxOccurrences: number | null;

  /** Próxima fecha a materializar. `null` si la regla ya terminó. */
  readonly nextRunDate: string | null;
  readonly lastRunAt: string | null;
  readonly occurrencesCreated: number;
  readonly autoPost: boolean;
  readonly isActive: boolean;
  readonly createdAt: string;
}

/** Resultado de una corrida del job. Es lo que devuelve el endpoint de cron. */
export interface MaterializationReport {
  readonly until: string;
  readonly rulesExamined: number;
  readonly rulesAdvanced: number;
  readonly transactionsCreated: number;
  /** Reglas que llegaron al tope y siguen con atraso pendiente. */
  readonly rulesTruncated: number;
  /** Reglas que se dieron por terminadas en esta corrida. */
  readonly rulesCompleted: number;
  /** Reglas que fallaron. El job sigue con las demás. */
  readonly rulesFailed: number;
}
