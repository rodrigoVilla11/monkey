import { z } from "zod";

import { isCurrencyCode } from "../currency";
import type { DebtDirection, DebtStatus } from "../debt";
import {
  amountMinorSchema,
  calendarDateSchema,
  cuidSchema,
  type MoneyDTO,
} from "./common";

/**
 * Deudas y préstamos.
 *
 * Una deuda es un acuerdo con alguien —"le debo 5.000 a mi hermano", "el
 * préstamo del coche"— y una lista de pagos. El saldo es `original − pagos`:
 * Monkey registra, no amortiza. Ver `shared/debt.ts` para el porqué.
 *
 * Módulo puro: sin Next, sin Prisma, sin React.
 */

export const DEBT_DIRECTIONS = ["OWED_BY_ME", "OWED_TO_ME"] as const;

export const DEBT_DIRECTION_LABELS: Readonly<Record<DebtDirection, string>> = {
  OWED_BY_ME: "Debo",
  OWED_TO_ME: "Me deben",
};

const positiveAmount = amountMinorSchema.refine(
  // El guard de dígitos no sobra: Zod corre los refinements aunque el regex
  // base ya haya fallado, y `BigInt("1.5")` lanza un SyntaxError.
  (value) => /^\d+$/.test(value) && BigInt(value) > 0n,
  "El importe tiene que ser mayor que cero",
);

const base = {
  direction: z.enum(DEBT_DIRECTIONS),
  /** Con quién es el acuerdo. Texto libre: no todo el mundo está en la app. */
  counterparty: z.string().trim().min(1, "Falta con quién").max(80),
  description: z.string().trim().max(200).nullable().optional(),
  originalAmountMinor: positiveAmount,
  /** Si no viene, la moneda primaria del Space. */
  currency: z
    .string()
    .refine(isCurrencyCode, "Código de moneda ISO 4217 inválido")
    .optional(),
  /**
   * Tasa anual en basis points (1 % = 100). Entero, para no meter floats.
   * `null` = sin interés pactado, que no es lo mismo que 0 %.
   */
  interestRateBps: z.number().int().min(0).max(1_000_000).nullable().optional(),
  /** Cuenta donde entró o de donde sale la plata. Contexto, no cálculo. */
  accountId: cuidSchema.nullable().optional(),
  startDate: calendarDateSchema,
  dueDate: calendarDateSchema.nullable().optional(),
  installmentsTotal: z.number().int().min(1).max(600).nullable().optional(),
};

export const createDebtRequestSchema = z
  .object(base)
  .refine(
    (value) => value.dueDate == null || value.dueDate >= value.startDate,
    {
      message: "El vencimiento no puede ser anterior al inicio",
      path: ["dueDate"],
    },
  );

export const updateDebtRequestSchema = z
  .object({
    counterparty: base.counterparty.optional(),
    description: base.description,
    originalAmountMinor: positiveAmount.optional(),
    interestRateBps: base.interestRateBps,
    accountId: cuidSchema.nullable().optional(),
    startDate: calendarDateSchema.optional(),
    dueDate: calendarDateSchema.nullable().optional(),
    installmentsTotal: base.installmentsTotal,
    /**
     * `direction` y `currency` no se editan: los pagos ya cargados están en esa
     * moneda, y dar vuelta el sentido convertiría una deuda en un préstamo
     * reinterpretando todo su historial.
     */
  })
  .refine(
    (value) => Object.keys(value).length > 0,
    "Hay que mandar al menos un campo",
  );

/**
 * Un pago.
 *
 * Igual que los aportes a metas: o se vincula a un movimiento que ya existe
 * —y el importe sale de ahí, así no pueden discrepar— o se registra suelto.
 *
 * **Nunca crea un movimiento.** Si generara uno, cargar el pago desde acá y
 * desde la pantalla de movimientos duplicaría el gasto.
 */
export const createDebtPaymentRequestSchema = z
  .object({
    transactionId: cuidSchema.optional(),
    amountMinor: positiveAmount.optional(),
    date: calendarDateSchema.optional(),
    /** Qué cuota es, si la deuda se pactó en cuotas. */
    installmentNo: z.number().int().min(1).max(600).nullable().optional(),
  })
  .refine(
    (value) =>
      (value.transactionId === undefined) !== (value.amountMinor === undefined),
    "Mandá un movimiento a vincular o un importe, pero no los dos",
  );

export type CreateDebtRequest = z.infer<typeof createDebtRequestSchema>;
export type UpdateDebtRequest = z.infer<typeof updateDebtRequestSchema>;
export type CreateDebtPaymentRequest = z.infer<
  typeof createDebtPaymentRequestSchema
>;

export const debtFiltersSchema = z.object({
  includeSettled: z
    .union([z.boolean(), z.enum(["true", "false"])])
    .transform((v) => v === true || v === "true")
    .optional(),
  direction: z.enum(DEBT_DIRECTIONS).optional(),
});

export type DebtFilters = z.infer<typeof debtFiltersSchema>;

// ────────────────────────────── respuestas ───────────────────────────────────

export interface DebtPaymentDTO {
  readonly id: string;
  readonly amount: MoneyDTO;
  readonly date: string;
  readonly installmentNo: number | null;
  readonly transaction: {
    readonly id: string;
    readonly description: string | null;
    readonly accountName: string;
  } | null;
  readonly createdAt: string;
}

export interface DebtDTO {
  readonly id: string;
  readonly direction: DebtDirection;
  readonly counterparty: string;
  readonly description: string | null;

  readonly original: MoneyDTO;
  readonly paid: MoneyDTO;
  readonly remaining: MoneyDTO;
  /** Lo pagado de más. Cero si todavía falta. */
  readonly overpaid: MoneyDTO;
  readonly percentage: number;
  readonly settled: boolean;
  readonly closedAt: string | null;

  readonly interestRateBps: number | null;
  /**
   * Lo que cuesta por mes el saldo pendiente a esa tasa. **No es una cuota**:
   * Monkey no calcula el plan de amortización de nadie.
   */
  readonly monthlyInterestCost: MoneyDTO | null;

  readonly startDate: string;
  readonly dueDate: string | null;
  readonly installments: {
    readonly paid: number;
    readonly total: number;
  } | null;
  readonly paymentCount: number;

  readonly account: {
    readonly id: string;
    readonly name: string;
    readonly currency: string;
  } | null;

  // ── proyección ──
  readonly status: DebtStatus;
  readonly daysRemaining: number | null;
  readonly requiredPerMonth: MoneyDTO | null;
  readonly actualPerMonth: MoneyDTO | null;
  readonly projectedDate: string | null;

  readonly createdAt: string;
}

/** Detalle con el historial de pagos. */
export interface DebtDetail extends DebtDTO {
  readonly payments: readonly DebtPaymentDTO[];
}

/**
 * Posición neta del Space: caja más lo que te deben menos lo que debés.
 *
 * Vive en su propio endpoint y NO en la curva de patrimonio de los reportes.
 * Esa curva es "saldo de cuentas" y meterle deudas redefiniría en silencio lo
 * que significan todos los reportes ya existentes.
 */
export interface NetPositionDTO {
  readonly accounts: MoneyDTO;
  readonly receivable: MoneyDTO;
  readonly payable: MoneyDTO;
  readonly net: MoneyDTO;
  /** Deudas en otra moneda que quedaron FUERA del total, para no mentir. */
  readonly excludedCount: number;
}
