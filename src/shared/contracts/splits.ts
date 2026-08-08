import { z } from "zod";

import {
  amountMinorSchema,
  calendarDateSchema,
  cuidSchema,
  type MoneyDTO,
} from "./common";

/**
 * Reparto de gastos entre miembros.
 *
 * ── La decisión que define el módulo ────────────────────────────────────────
 *
 * Un reparto es una **anotación** sobre un gasto, no una deuda. Generar una
 * fila de deuda por cada gasto compartido daría cincuenta deudas de siete euros
 * que nadie va a saldar una por una. Lo que hace falta es un número por persona
 * —que se calcula agregando— y una forma de decir "estamos a mano", que es el
 * saldado.
 *
 * Para que eso funcione hace falta saber **quién puso la plata**, que no es lo
 * mismo que quién cargó el movimiento: en un Space compartido, que Ana anote la
 * cena no dice nada de quién la pagó.
 *
 * Módulo puro: sin Next, sin Prisma, sin React.
 */

const positiveAmount = amountMinorSchema.refine(
  // El guard de dígitos no sobra: Zod corre los refinements aunque el regex
  // base ya haya fallado, y `BigInt("1.5")` lanza un SyntaxError.
  (value) => /^\d+$/.test(value) && BigInt(value) > 0n,
  "El importe tiene que ser mayor que cero",
);

export const SPLIT_MODES = ["EVEN", "PERCENTAGE", "EXACT"] as const;
export type SplitMode = (typeof SPLIT_MODES)[number];

export const SPLIT_MODE_LABELS: Readonly<Record<SplitMode, string>> = {
  EVEN: "Partes iguales",
  PERCENTAGE: "Por porcentaje",
  EXACT: "Importes exactos",
};

/**
 * Reparte un gasto.
 *
 * Reemplaza el reparto entero: mandar una lista parcial y que el servidor
 * adivine el resto sería una forma silenciosa de descuadrar la suma.
 */
export const setSplitRequestSchema = z
  .object({
    /**
     * Quién puso la plata. `null` = la cuenta común del Space, y entonces no
     * hay nada que repartir entre personas.
     */
    paidByUserId: cuidSchema.nullable(),
    mode: z.enum(SPLIT_MODES),
    participants: z
      .array(
        z.object({
          userId: cuidSchema,
          /** Solo en PERCENTAGE. Basis points: 1 % = 100. */
          bps: z.number().int().min(1).max(10_000).optional(),
          /** Solo en EXACT. */
          amountMinor: positiveAmount.optional(),
        }),
      )
      .min(1, "Hace falta al menos un participante")
      .max(20),
  })
  .superRefine((value, ctx) => {
    if (value.mode === "PERCENTAGE") {
      if (value.participants.some((p) => p.bps === undefined)) {
        ctx.addIssue({
          code: "custom",
          message: "Cada participante necesita su porcentaje",
          path: ["participants"],
        });
      }
    }

    if (value.mode === "EXACT") {
      if (value.participants.some((p) => p.amountMinor === undefined)) {
        ctx.addIssue({
          code: "custom",
          message: "Cada participante necesita su importe",
          path: ["participants"],
        });
      }
    }

    const ids = value.participants.map((p) => p.userId);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({
        code: "custom",
        message: "Hay un participante repetido",
        path: ["participants"],
      });
    }
  });

export type SetSplitRequest = z.infer<typeof setSplitRequestSchema>;

/**
 * Registra que alguien le pagó a alguien lo que le debía.
 *
 * **No genera un movimiento.** Saldar no mueve el patrimonio del Space, solo
 * reequilibra quién puso qué dentro de él; si generara uno, el mes en que se
 * saldan las cuentas parecería el mes de un gasto enorme.
 */
export const createSettlementRequestSchema = z
  .object({
    fromUserId: cuidSchema,
    toUserId: cuidSchema,
    amountMinor: positiveAmount,
    date: calendarDateSchema.optional(),
    note: z.string().trim().max(200).nullable().optional(),
  })
  .refine(
    (value) => value.fromUserId !== value.toUserId,
    "Nadie se salda cuentas consigo mismo",
  );

export type CreateSettlementRequest = z.infer<
  typeof createSettlementRequestSchema
>;

// ────────────────────────────── respuestas ───────────────────────────────────

export interface SplitShareDTO {
  readonly userId: string;
  readonly name: string;
  readonly avatarUrl: string | null;
  readonly amount: MoneyDTO;
  /** Porcentaje del total, con un decimal. Para la pantalla. */
  readonly percentage: number;
}

export interface TransactionSplitDTO {
  readonly transactionId: string;
  readonly total: MoneyDTO;
  readonly paidBy: {
    readonly userId: string;
    readonly name: string;
    readonly avatarUrl: string | null;
  } | null;
  readonly shares: readonly SplitShareDTO[];
}

export interface MemberBalanceDTO {
  readonly userId: string;
  readonly name: string;
  readonly avatarUrl: string | null;
  /** Lo que puso de su bolsillo en gastos repartidos. */
  readonly paid: MoneyDTO;
  /** Lo que le tocaba según los repartos. */
  readonly owed: MoneyDTO;
  /** paid − owed ± saldados. Positivo = le deben; negativo = debe. */
  readonly net: MoneyDTO;
}

export interface SuggestedPaymentDTO {
  readonly from: { readonly userId: string; readonly name: string };
  readonly to: { readonly userId: string; readonly name: string };
  readonly amount: MoneyDTO;
}

export interface SettlementDTO {
  readonly id: string;
  readonly from: { readonly userId: string; readonly name: string };
  readonly to: { readonly userId: string; readonly name: string };
  readonly amount: MoneyDTO;
  readonly date: string;
  readonly note: string | null;
  readonly createdAt: string;
}

/** La pantalla de "quién debe a quién", entera. */
export interface SplitSummaryDTO {
  readonly currency: string;
  readonly balances: readonly MemberBalanceDTO[];
  /**
   * Los pagos que dejarían todo en cero, con el mínimo de transferencias.
   * Con N personas son N−1 como mucho: sin esto, cuatro personas con deudas
   * cruzadas harían seis transferencias en vez de tres.
   */
  readonly suggested: readonly SuggestedPaymentDTO[];
  readonly settlements: readonly SettlementDTO[];
  /** Cuántos gastos tienen reparto. Cero = nadie repartió nada todavía. */
  readonly splitCount: number;
}
