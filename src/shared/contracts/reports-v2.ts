import { z } from "zod";

import { calendarDateSchema, type MoneyDTO } from "./common";

/**
 * Reportes de la Fase 2.
 *
 * Va aparte de `reports.ts` —que es el contrato del dashboard— porque son dos
 * consumidores distintos: el dashboard es una pantalla fija y esto es una
 * herramienta de análisis con rangos y pestañas.
 *
 * Módulo puro: sin Next, sin Prisma, sin React.
 */

/** Cuántos meses hacia atrás. 24 es el techo: más no entra en un teléfono. */
export const monthlyReportQuerySchema = z.object({
  months: z.coerce.number().int().min(2).max(24).default(12),
});

export const rangeReportQuerySchema = z.object({
  from: calendarDateSchema.optional(),
  to: calendarDateSchema.optional(),
});

export const categoryReportQuerySchema = rangeReportQuerySchema.extend({
  kind: z.enum(["INCOME", "EXPENSE"]).default("EXPENSE"),
});

export const comparisonQuerySchema = z.object({
  /** Mes a comparar contra el anterior. Por defecto, el actual. */
  month: calendarDateSchema.optional(),
  kind: z.enum(["INCOME", "EXPENSE"]).default("EXPENSE"),
});

export type MonthlyReportQuery = z.infer<typeof monthlyReportQuerySchema>;
export type RangeReportQuery = z.infer<typeof rangeReportQuerySchema>;
export type CategoryReportQuery = z.infer<typeof categoryReportQuerySchema>;
export type ComparisonQuery = z.infer<typeof comparisonQuerySchema>;

// ─────────────────────── evolución mensual y cash flow ───────────────────────

export interface MonthlyPoint {
  /** "YYYY-MM". */
  readonly month: string;
  /** Etiqueta ya formateada en el locale de quien pregunta. */
  readonly label: string;
  readonly income: MoneyDTO;
  readonly expense: MoneyDTO;
  /** income − expense. Puede ser negativo. */
  readonly net: MoneyDTO;
  /**
   * Patrimonio acumulado al cierre del mes: es la curva del cash flow.
   * Incluye las transferencias y el saldo de apertura de las cuentas, porque
   * sigue el patrimonio y no el resultado.
   */
  readonly runningBalance: MoneyDTO;
  readonly transactionCount: number;
}

export interface MonthlyReport {
  readonly currency: string;
  readonly points: readonly MonthlyPoint[];
  /** Promedios del período, útiles para leer el gráfico de un vistazo. */
  readonly averageIncome: MoneyDTO;
  readonly averageExpense: MoneyDTO;
  readonly averageNet: MoneyDTO;
  /** Mejor y peor mes por resultado neto. */
  readonly bestMonth: string | null;
  readonly worstMonth: string | null;
}

// ───────────────────────── desglose por categoría ────────────────────────────

export interface CategoryReportItem {
  readonly categoryId: string | null;
  readonly name: string;
  readonly color: string | null;
  readonly icon: string | null;
  readonly total: MoneyDTO;
  readonly percentage: number;
  readonly transactionCount: number;
  /** Detalle de las subcategorías que componen el total. */
  readonly children: readonly Omit<CategoryReportItem, "children">[];
}

export interface CategoryReport {
  readonly currency: string;
  readonly from: string;
  readonly to: string;
  readonly total: MoneyDTO;
  readonly items: readonly CategoryReportItem[];
}

// ────────────────────────── comparativa mes a mes ────────────────────────────

export interface ComparisonItem {
  readonly categoryId: string | null;
  readonly name: string;
  readonly color: string | null;
  readonly icon: string | null;
  readonly current: MoneyDTO;
  readonly previous: MoneyDTO;
  /** current − previous. Negativo = se gastó menos que el mes pasado. */
  readonly delta: MoneyDTO;
  /**
   * Variación porcentual. `null` cuando el mes anterior fue cero: dividir por
   * cero no da "infinito por ciento", da "no comparable".
   */
  readonly deltaPercentage: number | null;
  readonly isNew: boolean;
}

export interface ComparisonReport {
  readonly currency: string;
  readonly currentMonth: string;
  readonly previousMonth: string;
  readonly currentTotal: MoneyDTO;
  readonly previousTotal: MoneyDTO;
  readonly delta: MoneyDTO;
  readonly deltaPercentage: number | null;
  /** Ordenados por variación absoluta: primero lo que más cambió. */
  readonly items: readonly ComparisonItem[];
}

// ───────────────────────── desglose por miembro ──────────────────────────────

export interface MemberReportItem {
  readonly userId: string | null;
  readonly name: string;
  readonly avatarUrl: string | null;
  readonly total: MoneyDTO;
  readonly percentage: number;
  readonly transactionCount: number;
}

export interface MemberReport {
  readonly currency: string;
  readonly from: string;
  readonly to: string;
  readonly total: MoneyDTO;
  readonly items: readonly MemberReportItem[];
}
