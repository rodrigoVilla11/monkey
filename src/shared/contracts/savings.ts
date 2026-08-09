import { z } from "zod";

import { isCurrencyCode } from "../currency";
import type { GoalPace } from "../savings";
import {
  amountMinorSchema,
  calendarDateSchema,
  cuidSchema,
  signedAmountMinorSchema,
  type MoneyDTO,
} from "./common";
import { RECURRENCE_FREQUENCIES } from "./recurring";

/**
 * Metas de ahorro.
 *
 * Una meta es un objetivo con nombre —"viaje a Japón", "colchón de tres
 * meses"— y una lista de aportes. El progreso son los aportes, no el saldo de
 * ninguna cuenta: ver `shared/savings.ts` para el porqué.
 *
 * Módulo puro: sin Next, sin Prisma, sin React.
 */

const base = {
  name: z.string().trim().min(1, "El nombre es obligatorio").max(60),
  targetAmountMinor: amountMinorSchema.refine(
    // El guard de dígitos no sobra: Zod corre los refinements aunque el regex
    // base ya haya fallado, y `BigInt("1.5")` lanza un SyntaxError.
    (value) => /^\d+$/.test(value) && BigInt(value) > 0n,
    "El objetivo tiene que ser mayor que cero",
  ),
  /** Si no viene, la moneda primaria del Space. */
  currency: z
    .string()
    .refine(isCurrencyCode, "Código de moneda ISO 4217 inválido")
    .optional(),
  /**
   * Cuenta donde vive la plata. Es contexto, no la fuente del progreso: sirve
   * para proponerla al registrar un aporte y para saber dónde mirar.
   */
  accountId: cuidSchema.nullable().optional(),
  targetDate: calendarDateSchema.nullable().optional(),
  icon: z.string().trim().max(40).nullable().optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Color hexadecimal inválido")
    .nullable()
    .optional(),
};

/**
 * La forma elegida para llegar: cuánto apartar y cada cuánto.
 *
 * Llega como objeto porque los cuatro campos van juntos o ninguno —lo mismo que
 * garantiza el CHECK de la base—, así el "ninguno" se dice con un `null`.
 *
 * La app propone las opciones (`goalPlanOptions`) pero acá se acepta cualquier
 * importe: quien quiera apartar 200 redondos en vez de los 156,25 que salen de
 * la división tiene que poder, y la pantalla ya le dice si con eso llega.
 */
const planSchema = z.object({
  amountMinor: amountMinorSchema.refine(
    (value) => /^\d+$/.test(value) && BigInt(value) > 0n,
    "El importe tiene que ser mayor que cero",
  ),
  frequency: z.enum(RECURRENCE_FREQUENCIES),
  interval: z.number().int().min(1).max(365).default(1),
  startDate: calendarDateSchema,
});

export const createSavingsGoalRequestSchema = z.object({
  ...base,
  plan: planSchema.nullable().optional(),
});

export const updateSavingsGoalRequestSchema = z
  .object({
    name: base.name.optional(),
    targetAmountMinor: base.targetAmountMinor.optional(),
    accountId: cuidSchema.nullable().optional(),
    targetDate: calendarDateSchema.nullable().optional(),
    icon: base.icon,
    color: base.color,
    /** `null` saca el plan; un objeto lo reemplaza entero, nunca a medias. */
    plan: planSchema.nullable().optional(),
    /**
     * `currency` no se edita: los aportes ya cargados están en esa moneda y
     * cambiarla los reinterpretaría en silencio.
     */
  })
  .refine(
    (value) => Object.keys(value).length > 0,
    "Hay que mandar al menos un campo",
  );

/**
 * Un aporte.
 *
 * Dos formas de cargarlo, y la diferencia importa:
 *
 *  · **Vinculado a un movimiento** (`transactionId`) — el caso normal: la
 *    transferencia a la cuenta de ahorro que ya está cargada. El importe sale
 *    del movimiento, no se escribe a mano, así que no pueden discrepar.
 *  · **Suelto** (`amountMinor`) — para lo que se ahorró fuera de la app.
 *
 * `amountMinor` admite negativos: un retiro de la meta. Sacar plata del ahorro
 * es un hecho tan real como ponerla, y no registrarlo dejaría la barra
 * mintiendo.
 */
export const createContributionRequestSchema = z
  .object({
    transactionId: cuidSchema.optional(),
    amountMinor: signedAmountMinorSchema.optional(),
    date: calendarDateSchema.optional(),
    note: z.string().trim().max(200).nullable().optional(),
  })
  .refine(
    (value) =>
      (value.transactionId === undefined) !== (value.amountMinor === undefined),
    "Mandá un movimiento a vincular o un importe, pero no los dos",
  )
  .refine(
    (value) =>
      value.amountMinor === undefined || BigInt(value.amountMinor) !== 0n,
    "Un aporte de cero no aporta nada",
  );

export type CreateSavingsGoalRequest = z.infer<
  typeof createSavingsGoalRequestSchema
>;
export type UpdateSavingsGoalRequest = z.infer<
  typeof updateSavingsGoalRequestSchema
>;
export type CreateContributionRequest = z.infer<
  typeof createContributionRequestSchema
>;

export const savingsGoalFiltersSchema = z.object({
  includeAchieved: z
    .union([z.boolean(), z.enum(["true", "false"])])
    .transform((v) => v === true || v === "true")
    .optional(),
});

export type SavingsGoalFilters = z.infer<typeof savingsGoalFiltersSchema>;

// ────────────────────────────── respuestas ───────────────────────────────────

export interface ContributionDTO {
  readonly id: string;
  readonly amount: MoneyDTO;
  readonly date: string;
  readonly note: string | null;
  /** El movimiento que lo respalda, si vino de uno. */
  readonly transaction: {
    readonly id: string;
    readonly description: string | null;
    readonly accountName: string;
  } | null;
  readonly createdAt: string;
}

export interface SavingsGoalDTO {
  readonly id: string;
  readonly name: string;
  readonly icon: string | null;
  readonly color: string | null;
  readonly target: MoneyDTO;
  readonly saved: MoneyDTO;
  readonly remaining: MoneyDTO;
  /** Lo que se pasó del objetivo. Cero si todavía no llegó. */
  readonly surplus: MoneyDTO;
  readonly percentage: number;
  readonly achieved: boolean;
  readonly achievedAt: string | null;
  readonly targetDate: string | null;
  readonly account: {
    readonly id: string;
    readonly name: string;
    readonly currency: string;
  } | null;
  readonly contributionCount: number;

  // ── proyección ──
  readonly pace: GoalPace;
  readonly daysRemaining: number | null;
  /** Cuánto habría que apartar por mes para llegar a tiempo. */
  readonly requiredPerMonth: MoneyDTO | null;
  /** Ritmo real desde el primer aporte. */
  readonly actualPerMonth: MoneyDTO | null;
  /** Fecha estimada de llegada al ritmo actual. */
  readonly projectedDate: string | null;

  /**
   * Formas de llegar antes de la fecha, calculadas de lo que falta.
   *
   * Se mandan siempre —no solo cuando no hay plan— para que cambiar de idea sea
   * elegir otra, y para que después de un mes flojo las propuestas ya estén
   * recalculadas sobre lo que falta de verdad. Vacío si no hay fecha objetivo o
   * si ya se alcanzó.
   */
  readonly planOptions: readonly {
    readonly frequency: (typeof RECURRENCE_FREQUENCIES)[number];
    readonly interval: number;
    readonly amount: MoneyDTO;
    readonly count: number;
    readonly lastDate: string;
    /** La cadencia en una línea, ya armada por el servidor. */
    readonly description: string;
  }[];

  /**
   * La forma elegida y cómo va contra los aportes reales.
   *
   * `behind` es lo que falta de lo que YA venció, no lo que falta en total: la
   * diferencia entre "te saltaste dos semanas" y "todavía te faltan 2.500".
   */
  readonly plan: {
    readonly amount: MoneyDTO;
    readonly frequency: (typeof RECURRENCE_FREQUENCIES)[number];
    readonly interval: number;
    readonly startDate: string;
    readonly description: string;
    readonly nextDate: string | null;
    readonly expectedToDate: MoneyDTO;
    readonly behind: MoneyDTO;
    readonly dueCount: number;
    /** Cuántos aportes faltan al importe elegido. Sale del saldo. */
    readonly remainingContributions: number;
    /** Cuándo se llegaría si el plan se cumple. */
    readonly arrivalDate: string | null;
  } | null;

  readonly createdAt: string;
}

/** Detalle con el historial de aportes. */
export interface SavingsGoalDetail extends SavingsGoalDTO {
  readonly contributions: readonly ContributionDTO[];
}

/**
 * Un recordatorio del inicio: una meta con plan y lo que toca hacer.
 *
 * Es lo mínimo para decir una frase —"apartá 156,25 el domingo"— sin arrastrar
 * la meta entera al dashboard. No incluye el progreso porque el recordatorio no
 * es un informe: es lo que hay que hacer ahora.
 */
export interface GoalReminder {
  readonly id: string;
  readonly name: string;
  readonly color: string | null;
  readonly amount: MoneyDTO;
  /** La cadencia en una línea: "Todos los domingos". */
  readonly description: string;
  readonly nextDate: string | null;
  /** Lo que falta de lo que ya venció. Cero si está al día. */
  readonly behind: MoneyDTO;
  readonly remainingContributions: number;
}

/** Resumen para la tarjeta del dashboard. */
export interface SavingsSummary {
  readonly total: number;
  readonly achieved: number;
  readonly behind: number;
  readonly totalTarget: MoneyDTO;
  readonly totalSaved: MoneyDTO;
}
