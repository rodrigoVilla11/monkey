import {
  getCurrencyExponent,
  getCurrencyFactor,
  isCurrencyCode,
} from "./currency";

/**
 * Dinero.
 *
 * Regla número uno del proyecto: **nunca un float**. Todos los importes son
 * `bigint` en la unidad mínima de la moneda (céntimos, centavos, yenes) con su
 * código ISO 4217 al lado. `0.1 + 0.2 !== 0.3` no es aceptable en una app de
 * finanzas, y con ARS un `Number` se queda corto antes de lo que parece.
 *
 * Módulo puro: sin dependencias, sin Next, sin Prisma. Un cliente Expo lo
 * importa tal cual.
 *
 * Sobre el cable los importes viajan como **string**, no como number:
 * `JSON.stringify` no sabe serializar `bigint`, y un `number` pierde precisión
 * arriba de 2^53.
 */

export interface Money {
  /** Siempre positivo en Transaction: el signo lo determina el `type`. */
  readonly amountMinor: bigint;
  /** Código ISO 4217 en mayúsculas. */
  readonly currency: string;
}

export type MoneyErrorCode =
  | "EMPTY"
  | "INVALID_FORMAT"
  | "TOO_MANY_DECIMALS"
  | "INVALID_CURRENCY"
  | "CURRENCY_MISMATCH"
  | "INVALID_RATE";

export type MoneyResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: MoneyErrorCode };

const ok = <T>(value: T): MoneyResult<T> => ({ ok: true, value });
const fail = <T>(error: MoneyErrorCode): MoneyResult<T> => ({
  ok: false,
  error,
});

// ─────────────────────────────── construcción ────────────────────────────────

export const money = (amountMinor: bigint, currency: string): Money => ({
  amountMinor,
  currency,
});

export const zero = (currency: string): Money => money(0n, currency);

// ────────────────────────────── serialización ────────────────────────────────

/** Representación de transporte: el importe como string decimal en minor units. */
export interface MoneyDTO {
  readonly amountMinor: string;
  readonly currency: string;
}

export const toDTO = (value: Money): MoneyDTO => ({
  amountMinor: value.amountMinor.toString(),
  currency: value.currency,
});

export const fromDTO = (dto: MoneyDTO): MoneyResult<Money> => {
  if (!isCurrencyCode(dto.currency)) return fail("INVALID_CURRENCY");
  if (!/^-?\d+$/.test(dto.amountMinor)) return fail("INVALID_FORMAT");
  return ok(money(BigInt(dto.amountMinor), dto.currency));
};

// ─────────────────────────────── aritmética ──────────────────────────────────

const sameCurrency = (a: Money, b: Money): boolean => a.currency === b.currency;

export const add = (a: Money, b: Money): MoneyResult<Money> =>
  sameCurrency(a, b)
    ? ok(money(a.amountMinor + b.amountMinor, a.currency))
    : fail("CURRENCY_MISMATCH");

export const subtract = (a: Money, b: Money): MoneyResult<Money> =>
  sameCurrency(a, b)
    ? ok(money(a.amountMinor - b.amountMinor, a.currency))
    : fail("CURRENCY_MISMATCH");

export const negate = (value: Money): Money =>
  money(-value.amountMinor, value.currency);

export const abs = (value: Money): Money =>
  money(
    value.amountMinor < 0n ? -value.amountMinor : value.amountMinor,
    value.currency,
  );

export const isZero = (value: Money): boolean => value.amountMinor === 0n;
export const isNegative = (value: Money): boolean => value.amountMinor < 0n;

export const compare = (a: Money, b: Money): MoneyResult<number> => {
  if (!sameCurrency(a, b)) return fail("CURRENCY_MISMATCH");
  if (a.amountMinor < b.amountMinor) return ok(-1);
  if (a.amountMinor > b.amountMinor) return ok(1);
  return ok(0);
};

/** Suma una lista. Falla si se mezclan monedas: sumar EUR con ARS no significa nada. */
export const sum = (
  values: readonly Money[],
  currency: string,
): MoneyResult<Money> => {
  let total = 0n;
  for (const value of values) {
    if (value.currency !== currency) return fail("CURRENCY_MISMATCH");
    total += value.amountMinor;
  }
  return ok(money(total, currency));
};

// ────────────────────────────── redondeo ─────────────────────────────────────

/**
 * División entera con redondeo half-up **alejándose del cero**
 * (−2,5 → −3, igual que 2,5 → 3).
 *
 * Es el redondeo "de toda la vida" y el que espera cualquiera que mire un
 * ticket. No se usa banker's rounding: un usuario que suma a mano no entiende
 * por qué 2,5 dio 2 y 3,5 dio 4.
 */
export const divideRoundHalfUp = (
  numerator: bigint,
  denominator: bigint,
): bigint => {
  if (denominator === 0n) throw new RangeError("División por cero");

  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;

  const quotient = n / d;
  const remainder = n % d;
  // remainder/d >= 1/2  ⟺  remainder*2 >= d
  const rounded = remainder * 2n >= d ? quotient + 1n : quotient;

  return negative ? -rounded : rounded;
};

// ─────────────────────────────── parseo ──────────────────────────────────────

/** Separador decimal que usa un locale, sacado de Intl con fallback a ".". */
export const getDecimalSeparator = (locale: string): "." | "," => {
  try {
    const parts = new Intl.NumberFormat(locale).formatToParts(1.1);
    const decimal = parts.find((p) => p.type === "decimal")?.value;
    return decimal === "," ? "," : ".";
  } catch {
    return ".";
  }
};

interface ParseOptions {
  /**
   * Desambigua "1.234" y "1,234", que pueden ser mil doscientos treinta y
   * cuatro o uno coma doscientos treinta y cuatro según el país.
   * Si no se pasa, ese caso se interpreta como separador de miles.
   */
  readonly locale?: string;
}

/**
 * Convierte lo que escribió una persona a unidades mínimas.
 *
 * Acepta "1234,56", "1.234,56", "1,234.56", "1234.56", "€ 1.234,56", "-12,5".
 *
 * Desambiguación cuando hay un solo separador seguido de exactamente 3 dígitos
 * ("1.234"), que es el caso genuinamente ambiguo:
 *  · si el separador NO coincide con el decimal del locale → miles
 *  · si coincide → decimal
 *  · sin locale → miles (interpretación más frecuente y más conservadora:
 *    prefiere 1234 sobre 1,234)
 */
export const parseAmount = (
  input: string,
  currency: string,
  options: ParseOptions = {},
): MoneyResult<Money> => {
  if (!isCurrencyCode(currency)) return fail("INVALID_CURRENCY");

  const trimmed = input.trim();
  if (trimmed === "") return fail("EMPTY");

  // Fuera símbolos de moneda, espacios (incluido el fino de agrupación) y
  // separadores tipográficos, para que pegar desde otra app no rompa.
  const cleaned = trimmed.replace(/[\s   ']/g, "").replace(/[^\d.,+-]/g, "");

  if (cleaned === "") return fail("INVALID_FORMAT");

  const negative = cleaned.startsWith("-");
  const unsigned = cleaned.replace(/^[+-]/, "");

  if (unsigned === "" || /[+-]/.test(unsigned)) return fail("INVALID_FORMAT");
  if (!/^[\d.,]+$/.test(unsigned)) return fail("INVALID_FORMAT");

  const lastDot = unsigned.lastIndexOf(".");
  const lastComma = unsigned.lastIndexOf(",");

  let decimalSeparator: "." | "," | null = null;

  if (lastDot !== -1 && lastComma !== -1) {
    // Con ambos presentes, el último es el decimal: "1.234,56" / "1,234.56".
    decimalSeparator = lastDot > lastComma ? "." : ",";
  } else if (lastDot !== -1 || lastComma !== -1) {
    const separator = lastDot !== -1 ? "." : ",";
    const occurrences = unsigned.split(separator).length - 1;
    const digitsAfter = unsigned.length - unsigned.lastIndexOf(separator) - 1;

    if (occurrences > 1) {
      // "1.234.567": repetido, solo puede ser separador de miles.
      decimalSeparator = null;
    } else if (digitsAfter === 3) {
      const localeDecimal = options.locale
        ? getDecimalSeparator(options.locale)
        : null;
      decimalSeparator = localeDecimal === separator ? separator : null;
    } else {
      decimalSeparator = separator;
    }
  }

  let integerPart: string;
  let fractionPart: string;

  if (decimalSeparator === null) {
    integerPart = unsigned.replace(/[.,]/g, "");
    fractionPart = "";
  } else {
    const index = unsigned.lastIndexOf(decimalSeparator);
    integerPart = unsigned.slice(0, index).replace(/[.,]/g, "");
    fractionPart = unsigned.slice(index + 1);
    if (!/^\d*$/.test(fractionPart)) return fail("INVALID_FORMAT");
  }

  if (integerPart === "" && fractionPart === "") return fail("INVALID_FORMAT");
  if (!/^\d*$/.test(integerPart)) return fail("INVALID_FORMAT");

  const exponent = getCurrencyExponent(currency);

  // Se rechaza en vez de redondear: si alguien escribió 3 decimales en euros,
  // es un error de tipeo y hay que decírselo, no comerse un céntimo en silencio.
  if (fractionPart.length > exponent) return fail("TOO_MANY_DECIMALS");

  const padded = fractionPart.padEnd(exponent, "0");
  const digits = `${integerPart === "" ? "0" : integerPart}${padded}`;

  const amount = BigInt(digits);
  return ok(money(negative ? -amount : amount, currency));
};

// ────────────────────────────── formateo ─────────────────────────────────────

/** Importe como string decimal plano, sin símbolo ni agrupación: "1234.56". */
export const toDecimalString = (value: Money): string => {
  const exponent = getCurrencyExponent(value.currency);
  const negative = value.amountMinor < 0n;
  const digits = (negative ? -value.amountMinor : value.amountMinor)
    .toString()
    .padStart(exponent + 1, "0");

  const integerPart = digits.slice(0, digits.length - exponent);
  const fractionPart =
    exponent === 0 ? "" : digits.slice(digits.length - exponent);

  const body =
    fractionPart === "" ? integerPart : `${integerPart}.${fractionPart}`;
  return negative ? `-${body}` : body;
};

interface FormatOptions {
  /** Oculta el símbolo de moneda. Útil en tablas con una sola moneda. */
  readonly hideSymbol?: boolean;
  /** Fuerza el signo + en positivos. Para deltas mes contra mes. */
  readonly signDisplay?: "auto" | "always" | "never";
}

/**
 * Formatea para mostrar, respetando el locale de quien mira.
 *
 * Acá sí se usa `Intl`: los separadores y la posición del símbolo son
 * cosméticos y tienen fallback. Lo que NO puede depender de Intl es el
 * exponente, porque eso decide qué se persiste (ver currency.ts).
 */
export const formatMoney = (
  value: Money,
  locale: string,
  options: FormatOptions = {},
): string => {
  const exponent = getCurrencyExponent(value.currency);
  const decimalString = toDecimalString(value);
  const asNumber = Number(decimalString);

  try {
    return new Intl.NumberFormat(locale, {
      style: options.hideSymbol === true ? "decimal" : "currency",
      currency: value.currency,
      minimumFractionDigits: exponent,
      maximumFractionDigits: exponent,
      signDisplay: options.signDisplay ?? "auto",
    }).format(asNumber);
  } catch {
    // Locale o moneda que este runtime no conoce: se degrada, no se rompe.
    return options.hideSymbol === true
      ? decimalString
      : `${decimalString} ${value.currency}`;
  }
};

// ──────────────────────── conversión entre monedas ───────────────────────────

interface Rate {
  readonly numerator: bigint;
  readonly scale: number;
}

/**
 * Parsea un tipo de cambio decimal ("1234.5678") a fracción exacta.
 * Nunca pasa por `Number`: una cotización con muchos decimales perdería
 * precisión y esa pérdida se propagaría a todos los importes convertidos.
 */
export const parseRate = (rate: string): MoneyResult<Rate> => {
  const trimmed = rate.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return fail("INVALID_RATE");

  const [integerPart = "", fractionPart = ""] = trimmed.split(".");
  const numerator = BigInt(`${integerPart}${fractionPart}`);
  if (numerator === 0n) return fail("INVALID_RATE");

  return ok({ numerator, scale: fractionPart.length });
};

/**
 * Convierte un importe a otra moneda usando una cotización dada.
 *
 * `rate` se interpreta como: 1 unidad de `value.currency` = `rate` unidades de
 * `targetCurrency`.
 *
 * Toda la cuenta se hace con enteros. Ajusta además la diferencia de
 * exponentes entre monedas, que es lo que se suele olvidar: convertir EUR
 * (2 decimales) a JPY (0) no es solo multiplicar por la tasa.
 *
 *   resultado = amountMinor × rate × 10^(expDestino − expOrigen)
 */
export const convert = (
  value: Money,
  rate: string,
  targetCurrency: string,
): MoneyResult<Money> => {
  if (!isCurrencyCode(targetCurrency)) return fail("INVALID_CURRENCY");

  const parsed = parseRate(rate);
  if (!parsed.ok) return fail(parsed.error);

  const { numerator, scale } = parsed.value;

  const sourceFactor = getCurrencyFactor(value.currency);
  const targetFactor = getCurrencyFactor(targetCurrency);

  const numeratorTotal = value.amountMinor * numerator * targetFactor;
  const denominatorTotal = 10n ** BigInt(scale) * sourceFactor;

  return ok(
    money(divideRoundHalfUp(numeratorTotal, denominatorTotal), targetCurrency),
  );
};

/**
 * Reparte un importe en N partes sin perder ni ganar un céntimo.
 *
 * Los céntimos que sobran del redondeo se distribuyen de a uno entre las
 * primeras partes, así la suma de las partes es exactamente el total.
 * Lo necesita la división de gastos de la Fase 3, y también prorratear
 * comisiones.
 */
export const allocate = (
  value: Money,
  parts: number,
): MoneyResult<readonly Money[]> => {
  if (!Number.isInteger(parts) || parts < 1) return fail("INVALID_FORMAT");

  const total = value.amountMinor;
  const count = BigInt(parts);
  const base = total / count;
  const remainder = total - base * count;
  const step = remainder < 0n ? -1n : 1n;
  const extras = remainder < 0n ? -remainder : remainder;

  return ok(
    Array.from({ length: parts }, (_unused, index) =>
      money(BigInt(index) < extras ? base + step : base, value.currency),
    ),
  );
};
