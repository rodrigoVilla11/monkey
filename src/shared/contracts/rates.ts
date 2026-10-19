import { z } from "zod";

import { isCurrencyCode } from "../currency";
import { calendarDateSchema } from "./common";
import { exchangeRateSchema } from "./transactions";

/**
 * Cotizaciones entre monedas.
 *
 * `ExchangeRate` es la ÚNICA tabla del dominio sin `spaceId`: una cotización no
 * pertenece a nadie. Está en el allowlist de la extensión de scope.
 *
 * Eso tiene una consecuencia que conviene tener presente: **lo que carga un
 * Space lo ven todos**. En una instalación personal o de una pareja da igual y
 * ahorra tener que cargar lo mismo dos veces; en una instalación con
 * desconocidos no sería aceptable, y ahí la tabla necesitaría un `spaceId`.
 *
 * Módulo puro: sin Next, sin Prisma, sin React.
 */

const currency = z
  .string()
  .refine(isCurrencyCode, "Código de moneda ISO 4217 inválido");

export const createRateRequestSchema = z
  .object({
    baseCurrency: currency,
    quoteCurrency: currency,
    /** 1 unidad de `base` = `rate` unidades de `quote`. */
    rate: exchangeRateSchema,
    /** Si no viene, hoy. */
    date: calendarDateSchema.optional(),
  })
  .refine(
    (value) => value.baseCurrency !== value.quoteCurrency,
    "Las dos monedas tienen que ser distintas",
  );

export type CreateRateRequest = z.infer<typeof createRateRequestSchema>;

export const rateFiltersSchema = z.object({
  baseCurrency: currency.optional(),
  quoteCurrency: currency.optional(),
});

export type RateFilters = z.infer<typeof rateFiltersSchema>;

/**
 * Búsqueda de la cotización vigente para un par en una fecha: la misma que
 * usa el servidor para convertir. Existe para que una pantalla pueda mostrar
 * "con la cotización del día X entran N pesos" ANTES de guardar.
 */
export const rateLookupQuerySchema = z
  .object({
    baseCurrency: currency,
    quoteCurrency: currency,
    /** Si no viene, hoy en la timezone del Space. */
    date: calendarDateSchema.optional(),
  })
  .refine(
    (value) => value.baseCurrency !== value.quoteCurrency,
    "Las dos monedas tienen que ser distintas",
  );

export type RateLookupQuery = z.infer<typeof rateLookupQuerySchema>;

// ────────────────────────────── respuestas ───────────────────────────────────

export interface ExchangeRateDTO {
  readonly id: string;
  readonly baseCurrency: string;
  readonly quoteCurrency: string;
  readonly rate: string;
  readonly date: string;
  /** "manual" o el proveedor que la trajo. */
  readonly source: string;
  readonly createdAt: string;
}

/**
 * Un par que la app NECESITA y no tiene cotización.
 *
 * Es lo que convierte la pantalla de cotizaciones en algo útil en vez de un
 * formulario a ciegas: dice exactamente qué falta cargar para que el inicio
 * deje de decir "no se pudo convertir".
 */
export interface MissingRateDTO {
  readonly baseCurrency: string;
  readonly quoteCurrency: string;
  /** Por qué hace falta: "Cuenta en dólares", por ejemplo. */
  readonly reason: string;
}

export interface RatesResponse {
  readonly rates: readonly ExchangeRateDTO[];
  readonly missing: readonly MissingRateDTO[];
}

/**
 * La cotización vigente de un par en una fecha, ya resuelta: si lo cargado es
 * el par inverso, viene invertida y `source` termina en ":inverso". `date` es
 * la de la cotización usada, que puede ser anterior a la pedida (fin de
 * semana, feriado).
 */
export interface RateLookupDTO {
  readonly baseCurrency: string;
  readonly quoteCurrency: string;
  /** 1 unidad de `base` = `rate` unidades de `quote`. */
  readonly rate: string;
  readonly date: string;
  readonly source: string;
}

export interface RateLookupResponse {
  /** `null` si no hay ninguna cotización cargada para el par. */
  readonly rate: RateLookupDTO | null;
}
