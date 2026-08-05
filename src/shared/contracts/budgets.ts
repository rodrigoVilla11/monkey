import { z } from "zod";

import type { BudgetState } from "../budget";
import {
  amountMinorSchema,
  calendarDateSchema,
  cuidSchema,
  type MoneyDTO,
} from "./common";

/**
 * Presupuestos.
 *
 * Módulo puro: sin Next, sin Prisma, sin React.
 */

export const BUDGET_PERIODS = ["MONTHLY", "WEEKLY", "CUSTOM"] as const;
export type BudgetPeriod = (typeof BUDGET_PERIODS)[number];

export const BUDGET_PERIOD_LABELS: Readonly<Record<BudgetPeriod, string>> = {
  MONTHLY: "Mensual",
  WEEKLY: "Semanal",
  CUSTOM: "Período fijo",
};

const base = z.object({
  name: z.string().trim().min(1, "El nombre es obligatorio").max(60),
  /**
   * Null = presupuesto global del Space (tope de gasto total).
   * Con categoría, el tope incluye también sus subcategorías.
   */
  categoryId: cuidSchema.nullable().optional(),
  amountMinor: amountMinorSchema.refine(
    (v) => BigInt(v) > 0n,
    "El monto tiene que ser mayor a cero",
  ),
  period: z.enum(BUDGET_PERIODS),
  startDate: calendarDateSchema.optional(),
  endDate: calendarDateSchema.nullable().optional(),
  /**
   * Arrastra el saldo del período anterior. Lo que sobró suma; lo que faltó
   * resta. Es el comportamiento de "sobre": pasarse un mes se come el
   * siguiente.
   */
  rollover: z.boolean().optional(),
});

/**
 * Un presupuesto CUSTOM sin fecha de fin no tiene período que calcular. Hay un
 * CHECK en la base que lo garantiza; esto lo rechaza antes con un mensaje
 * entendible.
 */
const customNeedsEnd = <T extends z.ZodType>(schema: T) =>
  schema.refine(
    (value: unknown) => {
      const v = value as { period?: string; endDate?: string | null };
      return v.period !== "CUSTOM" || (v.endDate ?? null) !== null;
    },
    {
      message: "Un presupuesto de período fijo necesita fecha de fin",
      path: ["endDate"],
    },
  );

export const createBudgetRequestSchema = customNeedsEnd(base);

export const updateBudgetRequestSchema = customNeedsEnd(
  base
    .partial()
    .extend({ isActive: z.boolean().optional() })
    .refine(
      (value) => Object.keys(value).length > 0,
      "Hay que mandar al menos un campo",
    ),
);

export type CreateBudgetRequest = z.infer<typeof createBudgetRequestSchema>;
export type UpdateBudgetRequest = z.infer<typeof updateBudgetRequestSchema>;

// ────────────────────────────── respuestas ───────────────────────────────────

export interface BudgetDTO {
  readonly id: string;
  readonly name: string;
  readonly period: BudgetPeriod;
  readonly amount: MoneyDTO;
  readonly rollover: boolean;
  readonly isActive: boolean;
  readonly startDate: string;
  readonly endDate: string | null;
  readonly category: {
    readonly id: string;
    readonly name: string;
    readonly color: string | null;
    readonly icon: string | null;
  } | null;
}

/** Presupuesto con su estado calculado para el período en curso. */
export interface BudgetWithStatus extends BudgetDTO {
  readonly periodStart: string;
  readonly periodEnd: string;
  /** Cuándo se renueva. Null en los de período fijo. */
  readonly nextPeriodStart: string | null;
  /** Tope del período; con rollover incluye el arrastre. */
  readonly effectiveAmount: MoneyDTO;
  readonly spent: MoneyDTO;
  /** Negativo si hay sobregiro. */
  readonly remaining: MoneyDTO;
  /** Arrastre del acumulado. Cero si no hay rollover. */
  readonly carried: MoneyDTO;
  readonly percentage: number;
  readonly state: BudgetState;
  readonly hasEnded: boolean;
}

/** Resumen para la tarjeta del dashboard. */
export interface BudgetSummary {
  readonly total: number;
  readonly overBudget: number;
  readonly nearLimit: number;
  readonly totalAmount: MoneyDTO;
  readonly totalSpent: MoneyDTO;
}
