import { z } from "zod";

import {
  allowedGranularities,
  exceedsMaxRange,
  MAX_RANGE_MONTHS,
  SERIES_GRANULARITIES,
  type SeriesGranularity,
} from "../periods";
import { calendarDateSchema, type MoneyDTO } from "./common";

/**
 * Reportes de la Fase 2.
 *
 * Va aparte de `reports.ts` —que es el contrato del dashboard— porque son dos
 * consumidores distintos: el dashboard es una pantalla fija y esto es una
 * herramienta de análisis con rangos y pestañas.
 *
 * Todos los reportes aceptan un rango `from`/`to` inclusivo con las MISMAS
 * reglas (`withRangeRules`): o vienen los dos extremos o ninguno, ordenados y
 * de hasta 36 meses. Lo que cambia entre reportes es qué pasa cuando no
 * viene: la serie toma los últimos N meses y el resto el mes en curso.
 *
 * Módulo puro: sin Next, sin Prisma, sin React.
 */

export type { SeriesGranularity } from "../periods";

interface OptionalRange {
  readonly from?: string | undefined;
  readonly to?: string | undefined;
}

const rangeFields = {
  from: calendarDateSchema.optional(),
  to: calendarDateSchema.optional(),
};

const hasRange = (value: OptionalRange): value is Required<OptionalRange> =>
  value.from !== undefined && value.to !== undefined;

/**
 * Las reglas de un rango, aplicadas a cualquier schema que lo lleve. Están en
 * un solo lugar para que los cuatro endpoints no puedan diverger: un extremo
 * solo no es un rango, y un rango sin tope es una consulta sin tope.
 */
const withRangeRules = <T extends z.ZodType>(schema: T): T =>
  schema
    .refine(
      (value: unknown) => {
        const v = value as OptionalRange;
        return (v.from === undefined) === (v.to === undefined);
      },
      { message: "Hay que indicar inicio y fin", path: ["to"] },
    )
    .refine(
      (value: unknown) => {
        const v = value as OptionalRange;
        return !hasRange(v) || v.from <= v.to;
      },
      {
        message: "El inicio del rango tiene que ser anterior al fin",
        path: ["to"],
      },
    )
    .refine(
      (value: unknown) => {
        const v = value as OptionalRange;
        return !hasRange(v) || !exceedsMaxRange({ start: v.from, end: v.to });
      },
      {
        message: `El rango no puede superar los ${String(MAX_RANGE_MONTHS)} meses`,
        path: ["to"],
      },
    );

export const categoryReportQuerySchema = withRangeRules(
  z.object({
    ...rangeFields,
    kind: z.enum(["INCOME", "EXPENSE"]).default("EXPENSE"),
  }),
);

/**
 * Serie temporal. Con `from`/`to`, el corte se elige solo según el largo del
 * rango (ver `granularityFor`) salvo que se pida uno en concreto de los que
 * ese rango admite (`allowedGranularities`); sin rango, los últimos `months`
 * meses por mes.
 */
export const seriesReportQuerySchema = withRangeRules(
  z.object({
    ...rangeFields,
    months: z.coerce.number().int().min(1).max(24).optional(),
    granularity: z.enum(["auto", ...SERIES_GRANULARITIES]).default("auto"),
  }),
).refine(
  (value) =>
    value.granularity === "auto" ||
    !hasRange(value) ||
    allowedGranularities({ start: value.from, end: value.to }).includes(
      value.granularity,
    ),
  {
    message: "Ese corte no se puede usar con este rango",
    path: ["granularity"],
  },
);

/**
 * Comparativa. Con `from`/`to` se compara ese rango; si no, el mes de `month`
 * (o el actual). `against` dice contra qué: el período inmediatamente
 * anterior del mismo largo, o el mismo período del año pasado.
 */
export const comparisonQuerySchema = withRangeRules(
  z.object({
    ...rangeFields,
    month: calendarDateSchema.optional(),
    kind: z.enum(["INCOME", "EXPENSE"]).default("EXPENSE"),
    against: z.enum(["previous", "year"]).default("previous"),
  }),
);

export type CategoryReportQuery = z.infer<typeof categoryReportQuerySchema>;
export type SeriesReportQuery = z.infer<typeof seriesReportQuerySchema>;
export type ComparisonQuery = z.infer<typeof comparisonQuerySchema>;
export type ComparisonTarget = ComparisonQuery["against"];

/** Un rango tal como viaja en las respuestas. */
export interface PeriodDTO {
  readonly from: string;
  readonly to: string;
}

// ───────────────────────── serie temporal y cash flow ────────────────────────

export interface SeriesPoint {
  /** "YYYY-MM" por mes; la fecha de inicio del corte por día y por semana. */
  readonly key: string;
  readonly from: string;
  readonly to: string;
  /** Etiqueta corta para el eje, ya formateada en el locale de quien pregunta. */
  readonly label: string;
  /** Nombre completo del corte, para la tabla y el detalle. */
  readonly title: string;
  readonly income: MoneyDTO;
  readonly expense: MoneyDTO;
  /** income − expense. Puede ser negativo. */
  readonly net: MoneyDTO;
  /**
   * Patrimonio acumulado al cierre del corte: es la curva del cash flow.
   * Incluye las transferencias y el saldo de apertura de las cuentas, porque
   * sigue el patrimonio y no el resultado.
   */
  readonly runningBalance: MoneyDTO;
  /** Ingresos y gastos del corte. Las transferencias no cuentan acá. */
  readonly transactionCount: number;
  /**
   * Patas de transferencia del corte. No son actividad del resultado, pero
   * sí mueven el patrimonio: un desembolso de préstamo es un día que vale la
   * pena ver en la curva aunque no haya ningún gasto.
   */
  readonly transferCount: number;
}

export interface SeriesReport {
  readonly currency: string;
  readonly granularity: SeriesGranularity;
  readonly from: string;
  readonly to: string;
  readonly points: readonly SeriesPoint[];
  /** Totales del rango completo. */
  readonly totalIncome: MoneyDTO;
  readonly totalExpense: MoneyDTO;
  readonly totalNet: MoneyDTO;
  /**
   * Promedios por corte. Por día, sobre los días ya transcurridos del rango;
   * por semana y por mes, sobre los cortes con actividad.
   */
  readonly averageIncome: MoneyDTO;
  readonly averageExpense: MoneyDTO;
  readonly averageNet: MoneyDTO;
  /** Mejor y peor corte por resultado neto (su `key`). */
  readonly best: string | null;
  readonly worst: string | null;
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

// ──────────────────────────── comparativa ────────────────────────────────────

export interface ComparisonItem {
  readonly categoryId: string | null;
  readonly name: string;
  readonly color: string | null;
  readonly icon: string | null;
  readonly current: MoneyDTO;
  readonly previous: MoneyDTO;
  /** current − previous. Negativo = se gastó menos que en el período anterior. */
  readonly delta: MoneyDTO;
  /**
   * Variación porcentual. `null` cuando el período anterior fue cero: dividir
   * por cero no da "infinito por ciento", da "no comparable".
   */
  readonly deltaPercentage: number | null;
  readonly isNew: boolean;
}

export interface ComparisonReport {
  readonly currency: string;
  readonly against: ComparisonTarget;
  readonly current: PeriodDTO;
  readonly previous: PeriodDTO;
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
