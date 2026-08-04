/**
 * Monedas ISO 4217.
 *
 * Módulo puro: sin dependencias, para que lo pueda importar un cliente Expo.
 *
 * El dato que importa acá es el **exponente**: cuántos decimales tiene la
 * moneda, o sea cuántas unidades mínimas entran en una unidad mayor.
 * EUR → 2 (100 céntimos), JPY → 0 (no hay subdivisión), KWD → 3.
 *
 * Se guarda como tabla en vez de sacarlo de `Intl` porque:
 *  · Intl depende de que el runtime traiga datos ICU completos, y Hermes
 *    (React Native) puede venir recortado.
 *  · El exponente decide cuántos dígitos se PERSISTEN. No puede depender de
 *    en qué runtime corre el código, o la misma transacción valdría distinto
 *    en el server y en el teléfono.
 *
 * `Intl` sí se usa para FORMATEAR (§formatCurrency en money.ts), donde una
 * diferencia de separadores es cosmética y hay fallback.
 */

/** Se valida forma, no pertenencia: monedas nuevas no deberían requerir deploy. */
export const isCurrencyCode = (value: string): boolean =>
  /^[A-Z]{3}$/.test(value);

/** Exponente por defecto. Aplica a la enorme mayoría de las monedas. */
const DEFAULT_EXPONENT = 2;

/**
 * Solo las excepciones a 2 decimales. Cualquier código que no esté acá usa
 * DEFAULT_EXPONENT, así que agregar una moneda común no requiere tocar nada.
 */
const EXPONENT_OVERRIDES: Readonly<Record<string, number>> = {
  // Sin subdivisión
  BIF: 0,
  CLP: 0,
  DJF: 0,
  GNF: 0,
  ISK: 0,
  JPY: 0,
  KMF: 0,
  KRW: 0,
  PYG: 0,
  RWF: 0,
  UGX: 0,
  UYI: 0,
  VND: 0,
  VUV: 0,
  XAF: 0,
  XOF: 0,
  XPF: 0,
  // Tres decimales
  BHD: 3,
  IQD: 3,
  JOD: 3,
  KWD: 3,
  LYD: 3,
  OMR: 3,
  TND: 3,
  // Cuatro decimales (unidades de cuenta indexadas)
  CLF: 4,
  UYW: 4,
};

/**
 * Cuántos decimales tiene la moneda. Determina cuántas unidades mínimas
 * entran en una unidad mayor: 10^exponent.
 */
export const getCurrencyExponent = (currency: string): number =>
  EXPONENT_OVERRIDES[currency] ?? DEFAULT_EXPONENT;

/** 10^exponent como bigint. Es el factor entre unidad mayor y unidad mínima. */
export const getCurrencyFactor = (currency: string): bigint =>
  10n ** BigInt(getCurrencyExponent(currency));

/**
 * Monedas ofrecidas primero en los selectores de la UI. No es una restricción:
 * cualquier código ISO válido se acepta.
 */
export const SUGGESTED_CURRENCIES = [
  "EUR",
  "ARS",
  "USD",
  "GBP",
  "BRL",
  "CLP",
  "COP",
  "MXN",
  "PEN",
  "UYU",
  "CHF",
] as const;
