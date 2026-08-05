import { z } from "zod";

import { isCalendarDate } from "../dates";

/**
 * Piezas compartidas por todos los contratos del dominio.
 *
 * Módulo puro: sin Next, sin Prisma, sin React.
 */

/**
 * Importe en la unidad mínima de la moneda, como STRING.
 *
 * Nunca `number`: `JSON.stringify` no serializa `bigint` y un `number` pierde
 * precisión arriba de 2^53. El servidor lo convierte a `bigint` en cuanto lo
 * valida y no vuelve a salir de ahí.
 */
export const amountMinorSchema = z
  .string()
  .regex(/^\d+$/, "El importe tiene que ser un entero positivo")
  .refine((v) => v.length <= 19, "Importe fuera de rango");

/** Igual, pero admite negativos. Para saldos y deltas, no para importes. */
export const signedAmountMinorSchema = z
  .string()
  .regex(/^-?\d+$/, "Importe inválido")
  .refine((v) => v.replace("-", "").length <= 19, "Importe fuera de rango");

export const calendarDateSchema = z
  .string()
  .refine(isCalendarDate, "Fecha inválida, se espera YYYY-MM-DD");

export const cuidSchema = z.string().min(1).max(40);

export const hexColorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "Color hexadecimal inválido");

export const iconSchema = z.string().min(1).max(40);

/**
 * Paginación por cursor, no por offset.
 *
 * El listado de transacciones se ordena por fecha descendente y crece por el
 * principio: con offset, cargar un movimiento nuevo mientras alguien scrollea
 * desplaza toda la página y se ven duplicados. Con cursor, no.
 */
export const cursorPaginationSchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

export interface Page<T> {
  readonly items: readonly T[];
  readonly nextCursor: string | null;
}

/** Importe con su moneda, tal como viaja por la API. */
export interface MoneyDTO {
  readonly amountMinor: string;
  readonly currency: string;
}
