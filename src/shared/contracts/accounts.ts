import { z } from "zod";

import { isCurrencyCode } from "../currency";
import {
  hexColorSchema,
  iconSchema,
  signedAmountMinorSchema,
  type MoneyDTO,
} from "./common";

/**
 * Cuentas y billeteras.
 *
 * Módulo puro: sin Next, sin Prisma, sin React.
 */

export const ACCOUNT_TYPES = [
  "CASH",
  "BANK",
  "CREDIT_CARD",
  "INVESTMENT",
  "CRYPTO",
  "OTHER",
] as const;

export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const ACCOUNT_TYPE_LABELS: Readonly<Record<AccountType, string>> = {
  CASH: "Efectivo",
  BANK: "Cuenta bancaria",
  CREDIT_CARD: "Tarjeta de crédito",
  INVESTMENT: "Inversión",
  CRYPTO: "Cripto",
  OTHER: "Otra",
};

const dayOfMonth = z.number().int().min(1).max(31);

const baseAccountSchema = z.object({
  name: z.string().trim().min(1, "El nombre es obligatorio").max(60),
  type: z.enum(ACCOUNT_TYPES),
  color: hexColorSchema.nullable().optional(),
  icon: iconSchema.nullable().optional(),
  /** Puede ser negativo: una tarjeta puede arrancar con deuda. */
  initialBalanceMinor: signedAmountMinorSchema.optional(),
  creditClosingDay: dayOfMonth.nullable().optional(),
  creditDueDay: dayOfMonth.nullable().optional(),
});

/**
 * Los días de cierre y vencimiento solo tienen sentido en una tarjeta de
 * crédito. Hay un CHECK en la base que lo garantiza; esto lo rechaza antes,
 * con un mensaje entendible.
 */
const creditDaysRule = <T extends z.ZodType>(schema: T) =>
  schema.refine(
    (value: unknown) => {
      const v = value as {
        type?: string;
        creditClosingDay?: number | null;
        creditDueDay?: number | null;
      };
      if (v.type === "CREDIT_CARD") return true;
      return (
        (v.creditClosingDay ?? null) === null &&
        (v.creditDueDay ?? null) === null
      );
    },
    {
      message:
        "Los días de cierre y vencimiento solo aplican a tarjetas de crédito",
      path: ["creditClosingDay"],
    },
  );

export const createAccountRequestSchema = creditDaysRule(
  baseAccountSchema.extend({
    /**
     * Si no viene, se usa la moneda primaria del Space. Una cuenta puede tener
     * su propia moneda: una caja de ahorro en dólares dentro de un Space en
     * euros es un caso normal.
     */
    currency: z
      .string()
      .refine(isCurrencyCode, "Código de moneda ISO 4217 inválido")
      .optional(),
  }),
);

export const updateAccountRequestSchema = creditDaysRule(
  baseAccountSchema
    .partial()
    .extend({
      /**
       * `currency` NO se puede cambiar: los movimientos ya cargados quedarían
       * expresados en una moneda que la cuenta ya no tiene.
       * `initialBalanceMinor` sí, porque es un dato de apertura corregible.
       */
      sortOrder: z.number().int().min(0).max(9999).optional(),
    })
    .refine(
      (value) => Object.keys(value).length > 0,
      "Hay que mandar al menos un campo",
    ),
);

export type CreateAccountRequest = z.infer<typeof createAccountRequestSchema>;
export type UpdateAccountRequest = z.infer<typeof updateAccountRequestSchema>;

export interface AccountDTO {
  readonly id: string;
  readonly name: string;
  readonly type: AccountType;
  readonly currency: string;
  readonly initialBalanceMinor: string;
  readonly color: string | null;
  readonly icon: string | null;
  readonly sortOrder: number;
  readonly isArchived: boolean;
  readonly creditClosingDay: number | null;
  readonly creditDueDay: number | null;
  readonly createdAt: string;
}

/** Cuenta con su saldo calculado. El saldo NUNCA se guarda desnormalizado. */
export interface AccountWithBalance extends AccountDTO {
  readonly balance: MoneyDTO;
  readonly transactionCount: number;
}
