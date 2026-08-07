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

export const createSavingsGoalRequestSchema = z.object(base);

export const updateSavingsGoalRequestSchema = z
  .object({
    name: base.name.optional(),
    targetAmountMinor: base.targetAmountMinor.optional(),
    accountId: cuidSchema.nullable().optional(),
    targetDate: calendarDateSchema.nullable().optional(),
    icon: base.icon,
    color: base.color,
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

  readonly createdAt: string;
}

/** Detalle con el historial de aportes. */
export interface SavingsGoalDetail extends SavingsGoalDTO {
  readonly contributions: readonly ContributionDTO[];
}

/** Resumen para la tarjeta del dashboard. */
export interface SavingsSummary {
  readonly total: number;
  readonly achieved: number;
  readonly behind: number;
  readonly totalTarget: MoneyDTO;
  readonly totalSaved: MoneyDTO;
}
