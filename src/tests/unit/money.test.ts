import { describe, expect, it } from "vitest";

import {
  getCurrencyExponent,
  getCurrencyFactor,
  isCurrencyCode,
} from "@/shared/currency";
import {
  add,
  allocate,
  compare,
  convert,
  deriveRate,
  divideRoundHalfUp,
  formatMoney,
  fromDTO,
  money,
  negate,
  parseAmount,
  parseRate,
  subtract,
  sum,
  toDecimalString,
  toDTO,
} from "@/shared/money";

const unwrap = <T>(
  result: { ok: true; value: T } | { ok: false; error: string },
): T => {
  if (!result.ok) throw new Error(`esperaba ok, vino ${result.error}`);
  return result.value;
};

describe("currency", () => {
  it("valida la forma del código ISO 4217", () => {
    expect(isCurrencyCode("EUR")).toBe(true);
    expect(isCurrencyCode("ARS")).toBe(true);
    expect(isCurrencyCode("eur")).toBe(false);
    expect(isCurrencyCode("EURO")).toBe(false);
    expect(isCurrencyCode("E1R")).toBe(false);
  });

  it("conoce los exponentes que no son 2", () => {
    expect(getCurrencyExponent("EUR")).toBe(2);
    expect(getCurrencyExponent("ARS")).toBe(2);
    expect(getCurrencyExponent("JPY")).toBe(0);
    expect(getCurrencyExponent("CLP")).toBe(0);
    expect(getCurrencyExponent("KWD")).toBe(3);
    expect(getCurrencyExponent("CLF")).toBe(4);
  });

  it("asume 2 decimales para una moneda desconocida", () => {
    expect(getCurrencyExponent("ZZZ")).toBe(2);
    expect(getCurrencyFactor("ZZZ")).toBe(100n);
  });

  it("expone el factor como bigint", () => {
    expect(getCurrencyFactor("EUR")).toBe(100n);
    expect(getCurrencyFactor("JPY")).toBe(1n);
    expect(getCurrencyFactor("KWD")).toBe(1000n);
  });
});

describe("divideRoundHalfUp", () => {
  it("redondea a la mitad alejándose del cero", () => {
    expect(divideRoundHalfUp(5n, 2n)).toBe(3n);
    expect(divideRoundHalfUp(-5n, 2n)).toBe(-3n);
    expect(divideRoundHalfUp(7n, 2n)).toBe(4n);
    expect(divideRoundHalfUp(-7n, 2n)).toBe(-4n);
  });

  it("no redondea cuando la división es exacta", () => {
    expect(divideRoundHalfUp(10n, 5n)).toBe(2n);
    expect(divideRoundHalfUp(-10n, 5n)).toBe(-2n);
    expect(divideRoundHalfUp(0n, 7n)).toBe(0n);
  });

  it("redondea hacia abajo por debajo de la mitad", () => {
    expect(divideRoundHalfUp(4n, 3n)).toBe(1n);
    expect(divideRoundHalfUp(-4n, 3n)).toBe(-1n);
  });

  it("tira si el divisor es cero", () => {
    expect(() => divideRoundHalfUp(1n, 0n)).toThrow(RangeError);
  });
});

describe("parseAmount", () => {
  it("parsea el formato español: punto de miles, coma decimal", () => {
    expect(unwrap(parseAmount("1.234,56", "EUR")).amountMinor).toBe(123_456n);
    expect(unwrap(parseAmount("1234,56", "EUR")).amountMinor).toBe(123_456n);
  });

  it("parsea el formato inglés: coma de miles, punto decimal", () => {
    expect(unwrap(parseAmount("1,234.56", "EUR")).amountMinor).toBe(123_456n);
    expect(unwrap(parseAmount("1234.56", "EUR")).amountMinor).toBe(123_456n);
  });

  it("parsea enteros sin separador", () => {
    expect(unwrap(parseAmount("1234", "EUR")).amountMinor).toBe(123_400n);
    expect(unwrap(parseAmount("0", "EUR")).amountMinor).toBe(0n);
  });

  it("completa los decimales que falten", () => {
    expect(unwrap(parseAmount("12,5", "EUR")).amountMinor).toBe(1250n);
    expect(unwrap(parseAmount("12,", "EUR")).amountMinor).toBe(1200n);
    expect(unwrap(parseAmount(",5", "EUR")).amountMinor).toBe(50n);
  });

  it("acepta negativos", () => {
    expect(unwrap(parseAmount("-12,50", "EUR")).amountMinor).toBe(-1250n);
  });

  it("ignora símbolos de moneda y espacios pegados desde otra app", () => {
    expect(unwrap(parseAmount("€ 1.234,56", "EUR")).amountMinor).toBe(123_456n);
    expect(unwrap(parseAmount("$1,234.56", "USD")).amountMinor).toBe(123_456n);
    expect(unwrap(parseAmount("1 234,56", "EUR")).amountMinor).toBe(123_456n);
    expect(unwrap(parseAmount("1 234,56", "EUR")).amountMinor).toBe(123_456n);
  });

  it("trata varios separadores iguales como miles", () => {
    expect(unwrap(parseAmount("1.234.567", "EUR")).amountMinor).toBe(
      123_456_700n,
    );
    expect(unwrap(parseAmount("1,234,567", "EUR")).amountMinor).toBe(
      123_456_700n,
    );
  });

  describe('el caso ambiguo "1.234"', () => {
    it("sin locale lo interpreta como miles", () => {
      expect(unwrap(parseAmount("1.234", "EUR")).amountMinor).toBe(123_400n);
      expect(unwrap(parseAmount("1,234", "EUR")).amountMinor).toBe(123_400n);
    });

    it("con locale usa el separador decimal de ese locale", () => {
      // En es-ES la coma es decimal: "1,234" son 1,23 € (y sobra un dígito).
      expect(parseAmount("1,234", "EUR", { locale: "es-ES" }).ok).toBe(false);
      // El punto es de miles: "1.234" son mil doscientos treinta y cuatro.
      expect(
        unwrap(parseAmount("1.234", "EUR", { locale: "es-ES" })).amountMinor,
      ).toBe(123_400n);
    });

    it("en en-US es al revés", () => {
      expect(parseAmount("1.234", "EUR", { locale: "en-US" }).ok).toBe(false);
      expect(
        unwrap(parseAmount("1,234", "EUR", { locale: "en-US" })).amountMinor,
      ).toBe(123_400n);
    });
  });

  it("respeta el exponente de cada moneda", () => {
    expect(unwrap(parseAmount("1234", "JPY")).amountMinor).toBe(1234n);
    expect(unwrap(parseAmount("1.234,567", "KWD")).amountMinor).toBe(
      1_234_567n,
    );
  });

  it("rechaza más decimales de los que tiene la moneda en vez de redondear", () => {
    // Comerse un céntimo en silencio es peor que decirle a la persona que
    // escribió mal. Se pasa el locale porque "12,345" cae justo en el caso
    // ambiguo de 3 dígitos tras el separador.
    expect(parseAmount("12,345", "EUR", { locale: "es-ES" })).toEqual({
      ok: false,
      error: "TOO_MANY_DECIMALS",
    });
    expect(parseAmount("12.3456", "EUR")).toEqual({
      ok: false,
      error: "TOO_MANY_DECIMALS",
    });
    expect(parseAmount("12,5", "JPY")).toEqual({
      ok: false,
      error: "TOO_MANY_DECIMALS",
    });
  });

  it("sin locale, un separador con 3 dígitos detrás se lee como miles", () => {
    // Documenta el único caso genuinamente ambiguo. En la app real siempre hay
    // locale (viene del perfil), así que este camino es sobre todo para
    // importaciones de CSV sin configurar.
    expect(unwrap(parseAmount("12,345", "EUR")).amountMinor).toBe(1_234_500n);
  });

  it("rechaza entradas inválidas", () => {
    expect(parseAmount("", "EUR")).toEqual({ ok: false, error: "EMPTY" });
    expect(parseAmount("   ", "EUR")).toEqual({ ok: false, error: "EMPTY" });
    expect(parseAmount("abc", "EUR")).toEqual({
      ok: false,
      error: "INVALID_FORMAT",
    });
    expect(parseAmount("1-2", "EUR")).toEqual({
      ok: false,
      error: "INVALID_FORMAT",
    });
    expect(parseAmount("12,50", "eur")).toEqual({
      ok: false,
      error: "INVALID_CURRENCY",
    });
  });

  it("no pierde precisión con importes enormes", () => {
    // 90 billones de pesos en centavos: muy por encima de Number.MAX_SAFE_INTEGER.
    const result = unwrap(parseAmount("90000000000000,99", "ARS"));
    expect(result.amountMinor).toBe(9_000_000_000_000_099n);
    expect(toDecimalString(result)).toBe("90000000000000.99");
  });
});

describe("toDecimalString", () => {
  it("formatea con los decimales de la moneda", () => {
    expect(toDecimalString(money(123_456n, "EUR"))).toBe("1234.56");
    expect(toDecimalString(money(-123_456n, "EUR"))).toBe("-1234.56");
    expect(toDecimalString(money(5n, "EUR"))).toBe("0.05");
    expect(toDecimalString(money(0n, "EUR"))).toBe("0.00");
  });

  it("no pone decimales en monedas sin subdivisión", () => {
    expect(toDecimalString(money(1234n, "JPY"))).toBe("1234");
    expect(toDecimalString(money(0n, "CLP"))).toBe("0");
  });

  it("maneja monedas de tres decimales", () => {
    expect(toDecimalString(money(1_234_567n, "KWD"))).toBe("1234.567");
    expect(toDecimalString(money(7n, "KWD"))).toBe("0.007");
  });

  it("es la inversa de parseAmount", () => {
    for (const input of ["0,00", "0,01", "1234,56", "-9,99", "1000000,00"]) {
      const parsed = unwrap(parseAmount(input, "EUR"));
      expect(unwrap(parseAmount(toDecimalString(parsed), "EUR"))).toEqual(
        parsed,
      );
    }
  });
});

describe("formatMoney", () => {
  it("formatea según el locale de quien mira", () => {
    // Se usan 7 dígitos a propósito: el CLDR de es-ES NO agrupa los números de
    // 4 dígitos ("1234,56 €"), así que con 1.234,56 no se vería la diferencia.
    const amount = money(123_456_789n, "EUR");
    // Se normalizan los espacios: Intl usa NBSP y varía entre versiones de ICU.
    const es = formatMoney(amount, "es-ES").replace(/\s/g, " ");
    const en = formatMoney(amount, "en-US").replace(/\s/g, " ");

    expect(es).toContain("1.234.567,89");
    expect(en).toContain("1,234,567.89");
  });

  it("muestra la misma cantidad para los dos miembros de un Space", () => {
    // Un español y un argentino en el mismo Space ven el mismo importe,
    // cada uno con sus separadores.
    const amount = money(123_456_789n, "EUR");
    expect(formatMoney(amount, "es-ES")).toContain("1.234.567,89");
    expect(formatMoney(amount, "es-AR")).toContain("1.234.567,89");
  });

  it("puede ocultar el símbolo", () => {
    expect(
      formatMoney(money(123_456n, "EUR"), "es-ES", { hideSymbol: true }),
    ).not.toContain("€");
  });

  it("puede forzar el signo, para deltas mes contra mes", () => {
    expect(
      formatMoney(money(100n, "EUR"), "es-ES", { signDisplay: "always" }),
    ).toContain("+");
  });

  it("se degrada sin romper con un locale desconocido", () => {
    expect(formatMoney(money(123_456n, "EUR"), "xx-YY-zz")).toContain(
      "1234.56",
    );
  });
});

describe("aritmética", () => {
  it("suma y resta dentro de la misma moneda", () => {
    const a = money(1000n, "EUR");
    const b = money(250n, "EUR");
    expect(unwrap(add(a, b)).amountMinor).toBe(1250n);
    expect(unwrap(subtract(a, b)).amountMinor).toBe(750n);
  });

  it("se niega a mezclar monedas", () => {
    const eur = money(1000n, "EUR");
    const ars = money(1000n, "ARS");
    expect(add(eur, ars)).toEqual({ ok: false, error: "CURRENCY_MISMATCH" });
    expect(subtract(eur, ars)).toEqual({
      ok: false,
      error: "CURRENCY_MISMATCH",
    });
    expect(compare(eur, ars)).toEqual({
      ok: false,
      error: "CURRENCY_MISMATCH",
    });
  });

  it("niega importes", () => {
    expect(negate(money(1000n, "EUR")).amountMinor).toBe(-1000n);
    expect(negate(money(-1000n, "EUR")).amountMinor).toBe(1000n);
  });

  it("suma listas", () => {
    const values = [money(100n, "EUR"), money(250n, "EUR"), money(-50n, "EUR")];
    expect(unwrap(sum(values, "EUR")).amountMinor).toBe(300n);
    expect(unwrap(sum([], "EUR")).amountMinor).toBe(0n);
  });

  it("falla si la lista mezcla monedas", () => {
    expect(sum([money(100n, "EUR"), money(100n, "ARS")], "EUR")).toEqual({
      ok: false,
      error: "CURRENCY_MISMATCH",
    });
  });

  it("compara", () => {
    expect(unwrap(compare(money(1n, "EUR"), money(2n, "EUR")))).toBe(-1);
    expect(unwrap(compare(money(2n, "EUR"), money(1n, "EUR")))).toBe(1);
    expect(unwrap(compare(money(1n, "EUR"), money(1n, "EUR")))).toBe(0);
  });
});

describe("parseRate", () => {
  it("parsea cotizaciones sin pasar por Number", () => {
    expect(unwrap(parseRate("1234.5678"))).toEqual({
      numerator: 12_345_678n,
      scale: 4,
    });
    expect(unwrap(parseRate("1"))).toEqual({ numerator: 1n, scale: 0 });
  });

  it("conserva toda la precisión de una cotización larga", () => {
    // Esto en float sería 0.000123456789012 y perdería dígitos.
    expect(unwrap(parseRate("0.000123456789012345"))).toEqual({
      numerator: 123_456_789_012_345n,
      scale: 18,
    });
  });

  it("rechaza cotizaciones inválidas", () => {
    for (const bad of ["", "abc", "-1.5", "1.2.3", "0", "0.00", "1e5"]) {
      expect(parseRate(bad).ok, bad).toBe(false);
    }
  });
});

describe("convert", () => {
  it("convierte entre monedas del mismo exponente", () => {
    // 100,00 EUR a 1150,50 ARS por euro
    const result = unwrap(convert(money(10_000n, "EUR"), "1150.50", "ARS"));
    expect(result).toEqual({ amountMinor: 11_505_000n, currency: "ARS" });
  });

  it("ajusta la diferencia de exponentes entre monedas", () => {
    // 100,00 EUR → JPY (0 decimales) a 170,25 yenes por euro = 17.025 JPY
    const result = unwrap(convert(money(10_000n, "EUR"), "170.25", "JPY"));
    expect(result).toEqual({ amountMinor: 17_025n, currency: "JPY" });
  });

  it("convierte desde una moneda sin decimales", () => {
    // 1000 JPY → EUR a 0,0058 EUR por yen = 5,80 EUR
    const result = unwrap(convert(money(1000n, "JPY"), "0.0058", "EUR"));
    expect(result).toEqual({ amountMinor: 580n, currency: "EUR" });
  });

  it("redondea half-up el céntimo final", () => {
    // 1,00 EUR × 1,005 = 1,005 → 1,01
    expect(
      unwrap(convert(money(100n, "EUR"), "1.005", "USD")).amountMinor,
    ).toBe(101n);
    // 1,00 EUR × 1,004 = 1,004 → 1,00
    expect(
      unwrap(convert(money(100n, "EUR"), "1.004", "USD")).amountMinor,
    ).toBe(100n);
  });

  it("conserva el signo", () => {
    expect(
      unwrap(convert(money(-10_000n, "EUR"), "1150.50", "ARS")).amountMinor,
    ).toBe(-11_505_000n);
  });

  it("no pierde precisión con cotizaciones largas y montos grandes", () => {
    const result = unwrap(
      convert(money(100_000_000n, "EUR"), "1234.567891234567", "ARS"),
    );
    // 1.000.000,00 EUR × 1234,567891234567 = 1.234.567.891,234567 ARS
    // → 1.234.567.891,23 tras redondear al centavo.
    expect(toDecimalString(result)).toBe("1234567891.23");
  });

  it("rechaza cotizaciones y monedas inválidas", () => {
    expect(convert(money(100n, "EUR"), "0", "ARS").ok).toBe(false);
    expect(convert(money(100n, "EUR"), "abc", "ARS").ok).toBe(false);
    expect(convert(money(100n, "EUR"), "1.5", "ars").ok).toBe(false);
  });
});

describe("deriveRate", () => {
  it("saca la cotización implícita entre dos importes", () => {
    // Salieron 100,00 EUR y entraron 115.050,00 ARS → 1150,50 ARS por euro.
    expect(
      unwrap(deriveRate(money(10_000n, "EUR"), money(11_505_000n, "ARS"))),
    ).toBe("1150.5");
  });

  it("ajusta la diferencia de exponentes", () => {
    // 100,00 EUR → 17.025 JPY (sin decimales) = 170,25 yenes por euro.
    expect(
      unwrap(deriveRate(money(10_000n, "EUR"), money(17_025n, "JPY"))),
    ).toBe("170.25");
    // Y en el sentido inverso: 1000 JPY → 5,80 EUR = 0,0058 EUR por yen.
    expect(unwrap(deriveRate(money(1000n, "JPY"), money(580n, "EUR")))).toBe(
      "0.0058",
    );
  });

  it("es la inversa de convert", () => {
    // La ida y vuelta tiene que devolver el importe de destino exacto: es lo
    // que sostiene que una transferencia entre monedas quede neutra.
    const cases: [bigint, string, bigint, string][] = [
      [10_000n, "EUR", 11_505_000n, "ARS"],
      [1000n, "JPY", 580n, "EUR"],
      [123_456n, "USD", 9876n, "EUR"],
      [1n, "EUR", 1_234_567n, "ARS"],
    ];

    for (const [fromMinor, fromCurrency, toMinor, toCurrency] of cases) {
      const from = money(fromMinor, fromCurrency);
      const rate = unwrap(deriveRate(from, money(toMinor, toCurrency)));

      expect(unwrap(convert(from, rate, toCurrency)).amountMinor).toBe(toMinor);
    }
  });

  it("da 1 cuando los importes coinciden en la misma moneda", () => {
    expect(unwrap(deriveRate(money(500n, "EUR"), money(500n, "EUR")))).toBe(
      "1",
    );
  });

  it("rechaza importes en cero: no hay proporción ni cotización válida", () => {
    expect(deriveRate(money(0n, "EUR"), money(100n, "ARS")).ok).toBe(false);
    expect(deriveRate(money(100n, "EUR"), money(0n, "ARS")).ok).toBe(false);
  });

  it("rechaza una proporción que se redondea a cero", () => {
    // 10.000.000.000 ARS que se convierten en 1 céntimo de euro darían una
    // cotización por debajo del último de los 12 decimales.
    expect(deriveRate(money(10n ** 15n, "ARS"), money(1n, "EUR")).ok).toBe(
      false,
    );
  });

  it("rechaza códigos de moneda inválidos", () => {
    expect(deriveRate(money(100n, "eur"), money(100n, "ARS")).ok).toBe(false);
    expect(deriveRate(money(100n, "EUR"), money(100n, "XX")).ok).toBe(false);
  });
});

describe("allocate", () => {
  it("reparte sin perder ni ganar un céntimo", () => {
    // 10,00 € entre 3 no da un número redondo.
    const parts = unwrap(allocate(money(1000n, "EUR"), 3));
    expect(parts.map((p) => p.amountMinor)).toEqual([334n, 333n, 333n]);
    expect(parts.reduce((acc, p) => acc + p.amountMinor, 0n)).toBe(1000n);
  });

  it("reparte exacto cuando divide justo", () => {
    const parts = unwrap(allocate(money(900n, "EUR"), 3));
    expect(parts.map((p) => p.amountMinor)).toEqual([300n, 300n, 300n]);
  });

  it("maneja importes negativos", () => {
    const parts = unwrap(allocate(money(-1000n, "EUR"), 3));
    expect(parts.map((p) => p.amountMinor)).toEqual([-334n, -333n, -333n]);
    expect(parts.reduce((acc, p) => acc + p.amountMinor, 0n)).toBe(-1000n);
  });

  it("la suma de las partes siempre reconstruye el total", () => {
    for (let total = 0n; total <= 100n; total += 1n) {
      for (let n = 1; n <= 7; n += 1) {
        const parts = unwrap(allocate(money(total, "EUR"), n));
        expect(parts.reduce((acc, p) => acc + p.amountMinor, 0n)).toBe(total);
      }
    }
  });

  it("rechaza cantidades de partes inválidas", () => {
    expect(allocate(money(1000n, "EUR"), 0).ok).toBe(false);
    expect(allocate(money(1000n, "EUR"), -1).ok).toBe(false);
    expect(allocate(money(1000n, "EUR"), 1.5).ok).toBe(false);
  });
});

describe("serialización", () => {
  it("manda los importes como string, no como number", () => {
    // JSON.stringify no sabe serializar bigint, y un number perdería
    // precisión arriba de 2^53.
    const dto = toDTO(money(9_007_199_254_740_993n, "ARS"));
    expect(dto).toEqual({ amountMinor: "9007199254740993", currency: "ARS" });
    expect(JSON.stringify(dto)).toContain('"9007199254740993"');
  });

  it("hace ida y vuelta sin perder nada", () => {
    const original = money(-123_456_789_012_345n, "EUR");
    expect(unwrap(fromDTO(toDTO(original)))).toEqual(original);
  });

  it("rechaza DTOs mal formados", () => {
    expect(fromDTO({ amountMinor: "12.5", currency: "EUR" }).ok).toBe(false);
    expect(fromDTO({ amountMinor: "abc", currency: "EUR" }).ok).toBe(false);
    expect(fromDTO({ amountMinor: "100", currency: "eur" }).ok).toBe(false);
  });
});
