import { z } from "zod";

import { isCurrencyCode } from "../currency";
import {
  amountMinorSchema,
  calendarDateSchema,
  cuidSchema,
  type MoneyDTO,
} from "./common";

/**
 * Transacciones: el core del dominio.
 *
 * Módulo puro: sin Next, sin Prisma, sin React.
 */

export const TRANSACTION_TYPES = ["INCOME", "EXPENSE", "TRANSFER"] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

export const TRANSACTION_STATUSES = ["PENDING", "CLEARED"] as const;
export type TransactionStatus = (typeof TRANSACTION_STATUSES)[number];

/**
 * Cotización como string decimal, nunca como number.
 *
 * Una cotización con muchos decimales perdería precisión al pasar por `number`
 * y esa pérdida se propagaría a todos los importes convertidos.
 */
export const exchangeRateSchema = z
  .string()
  .regex(/^\d+(\.\d{1,12})?$/, "Cotización inválida")
  .refine(
    (v) => Number.parseFloat(v) > 0,
    "La cotización tiene que ser mayor a 0",
  );

export const createTransactionRequestSchema = z.object({
  accountId: cuidSchema,
  categoryId: cuidSchema.nullable().optional(),
  /**
   * TRANSFER no se crea por acá: necesita dos patas y va por su propio
   * endpoint (Fase 2). Aceptarlo acá dejaría media transferencia suelta.
   */
  type: z.enum(["INCOME", "EXPENSE"]),
  amountMinor: amountMinorSchema,
  /** Si no viene, se usa la moneda de la cuenta. */
  currency: z
    .string()
    .refine(isCurrencyCode, "Código de moneda ISO 4217 inválido")
    .optional(),
  /** Si no viene, el servidor usa "hoy" en la timezone de quien carga. */
  date: calendarDateSchema.optional(),
  description: z.string().trim().max(200).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  payee: z.string().trim().max(120).nullable().optional(),
  status: z.enum(TRANSACTION_STATUSES).optional(),
  tagIds: z.array(cuidSchema).max(20).optional(),
  /**
   * Cotización a usar si la moneda difiere de la primaria del Space. Si no
   * viene, el servidor busca la última guardada. Se congela en la transacción:
   * un reporte histórico nunca se recalcula con la cotización de hoy.
   */
  exchangeRate: exchangeRateSchema.optional(),
});

export const updateTransactionRequestSchema = z
  .object({
    accountId: cuidSchema.optional(),
    categoryId: cuidSchema.nullable().optional(),
    amountMinor: amountMinorSchema.optional(),
    date: calendarDateSchema.optional(),
    description: z.string().trim().max(200).nullable().optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
    payee: z.string().trim().max(120).nullable().optional(),
    status: z.enum(TRANSACTION_STATUSES).optional(),
    tagIds: z.array(cuidSchema).max(20).optional(),
    /**
     * `type` y `currency` no se editan: cambiarlos invalidaría la conversión
     * congelada y el signo de un movimiento ya contabilizado. Se borra y se
     * vuelve a cargar.
     */
  })
  .refine(
    (value) => Object.keys(value).length > 0,
    "Hay que mandar al menos un campo",
  );

export type CreateTransactionRequest = z.infer<
  typeof createTransactionRequestSchema
>;
export type UpdateTransactionRequest = z.infer<
  typeof updateTransactionRequestSchema
>;

// ─────────────────────────────── filtros ─────────────────────────────────────

/**
 * Filtros del listado. Todo opcional y combinable.
 *
 * Los arrays llegan como valores repetidos en la query string
 * (`?accountId=a&accountId=b`), así que se admite string suelto o array.
 */
const idList = z
  .union([cuidSchema, z.array(cuidSchema)])
  .transform((v) => (Array.isArray(v) ? v : [v]))
  .optional();

export const transactionFiltersSchema = z.object({
  from: calendarDateSchema.optional(),
  to: calendarDateSchema.optional(),
  accountId: idList,
  categoryId: idList,
  createdByUserId: idList,
  tagId: idList,
  type: z
    .union([z.enum(TRANSACTION_TYPES), z.array(z.enum(TRANSACTION_TYPES))])
    .transform((v) => (Array.isArray(v) ? v : [v]))
    .optional(),
  status: z.enum(TRANSACTION_STATUSES).optional(),
  minAmountMinor: amountMinorSchema.optional(),
  maxAmountMinor: amountMinorSchema.optional(),
  /** Busca en descripción, notas y beneficiario. */
  search: z.string().trim().max(100).optional(),
});

export type TransactionFilters = z.infer<typeof transactionFiltersSchema>;

// ────────────────────────────── respuestas ───────────────────────────────────

export interface TransactionAuthor {
  readonly userId: string | null;
  /** Congelado al crear: sobrevive al borrado de la cuenta de usuario. */
  readonly name: string;
  readonly avatarUrl: string | null;
}

export interface TransactionDTO {
  readonly id: string;
  readonly type: TransactionType;
  readonly status: TransactionStatus;
  readonly amount: MoneyDTO;
  /** Convertido a la moneda primaria del Space, congelado al crear. */
  readonly amountPrimary: MoneyDTO | null;
  readonly exchangeRate: string | null;
  readonly date: string;
  readonly description: string | null;
  readonly notes: string | null;
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
  readonly author: TransactionAuthor;
  readonly tags: readonly {
    readonly id: string;
    readonly name: string;
    readonly color: string | null;
  }[];
  readonly transferGroupId: string | null;
  readonly createdAt: string;
}

export const bulkDeleteRequestSchema = z.object({
  ids: z.array(cuidSchema).min(1).max(500),
});

export type BulkDeleteRequest = z.infer<typeof bulkDeleteRequestSchema>;

// ──────────────────────────────── tags ───────────────────────────────────────

export const createTagRequestSchema = z.object({
  name: z.string().trim().min(1).max(40),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Color hexadecimal inválido")
    .nullable()
    .optional(),
});

export const updateTagRequestSchema = createTagRequestSchema
  .partial()
  .refine(
    (value) => Object.keys(value).length > 0,
    "Hay que mandar al menos un campo",
  );

export type CreateTagRequest = z.infer<typeof createTagRequestSchema>;
export type UpdateTagRequest = z.infer<typeof updateTagRequestSchema>;

export interface TagDTO {
  readonly id: string;
  readonly name: string;
  readonly color: string | null;
  readonly transactionCount?: number;
}
