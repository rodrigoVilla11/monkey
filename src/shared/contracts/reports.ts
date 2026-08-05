import { z } from "zod";

import { calendarDateSchema, type MoneyDTO } from "./common";

/**
 * Dashboard y reportes.
 *
 * Módulo puro: sin Next, sin Prisma, sin React.
 */

export const dashboardQuerySchema = z.object({
  /**
   * Mes a mostrar. Si no viene, el servidor usa el mes actual en la timezone
   * de quien pregunta — no la del servidor, que estaría en UTC.
   */
  month: calendarDateSchema.optional(),
});

export type DashboardQuery = z.infer<typeof dashboardQuerySchema>;

/**
 * Patrimonio neto.
 *
 * Se devuelve **desglosado por moneda** además del total convertido, y no solo
 * el total, por una razón: convertir usa la última cotización conocida, que es
 * una estimación de hoy, no un dato histórico. Si falta la cotización de alguna
 * moneda, `converted` viene en null y `missingRates` dice cuáles — se prefiere
 * decir "no puedo convertir esto" antes que mostrar un número que parece
 * exacto y no lo es.
 */
export interface NetWorth {
  readonly byCurrency: readonly MoneyDTO[];
  readonly converted: MoneyDTO | null;
  readonly missingRates: readonly string[];
}

export interface AccountBalanceSummary {
  readonly accountId: string;
  readonly name: string;
  readonly type: string;
  readonly color: string | null;
  readonly icon: string | null;
  readonly balance: MoneyDTO;
  readonly isArchived: boolean;
}

export interface CategoryBreakdownItem {
  readonly categoryId: string | null;
  readonly name: string;
  readonly color: string | null;
  readonly icon: string | null;
  readonly total: MoneyDTO;
  /** Porcentaje sobre el total del período, con un decimal. */
  readonly percentage: number;
}

export interface MonthSummary {
  readonly from: string;
  readonly to: string;
  readonly income: MoneyDTO;
  readonly expense: MoneyDTO;
  /** income − expense. Puede ser negativo. */
  readonly net: MoneyDTO;
  readonly transactionCount: number;
}

export interface MemberBreakdownItem {
  readonly userId: string | null;
  readonly name: string;
  readonly avatarUrl: string | null;
  readonly total: MoneyDTO;
  readonly transactionCount: number;
}

export interface DashboardResponse {
  readonly primaryCurrency: string;
  readonly month: MonthSummary;
  readonly previousMonth: MonthSummary;
  readonly netWorth: NetWorth;
  readonly accounts: readonly AccountBalanceSummary[];
  readonly topExpenseCategories: readonly CategoryBreakdownItem[];
  /** Solo en Spaces compartidos; en los personales viene vacío. */
  readonly byMember: readonly MemberBreakdownItem[];
}
