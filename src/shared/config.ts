/**
 * Configuración visible desde el cliente.
 *
 * `src/env.ts` es server-only: importa Zod, valida secretos y no puede entrar
 * en el bundle del navegador. Este archivo es su contraparte pública, y el
 * ÚNICO lugar del código de cliente autorizado a leer `process.env`.
 *
 * Todo lo que viva acá:
 *  · lo inlinea el bundler en tiempo de build (no se lee en runtime)
 *  · termina en el JavaScript que baja cualquiera, así que nunca puede ser
 *    un secreto
 *
 * Si mañana hace falta exponer algo más, va con prefijo NEXT_PUBLIC_ y se
 * agrega acá — no leyendo `process.env` suelto por los componentes.
 */

export const isProduction = process.env.NODE_ENV === "production";
export const isDevelopment = process.env.NODE_ENV === "development";
