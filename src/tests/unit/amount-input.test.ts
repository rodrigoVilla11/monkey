import { describe, expect, it } from "vitest";

import { isAmountInput, minorToInput, toMinor } from "@/lib/format";

/**
 * Lo que se teclea en un input de importe.
 *
 * Vivía copiado en cuatro pantallas y sin un solo test. Es la frontera entre
 * un string escrito a mano y el entero que termina en la base, así que es
 * exactamente donde un `parseFloat` mal puesto se convierte en un céntimo
 * perdido que nadie sabe explicar.
 */

describe("toMinor", () => {
  it("acepta coma y punto: en España y en Argentina se escribe con coma", () => {
    expect(toMinor("12,5", 2)).toBe("1250");
    expect(toMinor("12.5", 2)).toBe("1250");
  });

  it("rellena los decimales que falten", () => {
    expect(toMinor("7", 2)).toBe("700");
    expect(toMinor("7,", 2)).toBe("700");
    expect(toMinor("7,3", 2)).toBe("730");
  });

  it("corta los decimales de más en vez de redondear", () => {
    // Quien tecleó 10,999 en euros quiso decir 10,99. Redondear a 11,00 le
    // estaría corrigiendo el importe sin avisar.
    expect(toMinor("10,999", 2)).toBe("1099");
  });

  it("respeta el exponente de la moneda", () => {
    expect(toMinor("1500", 0)).toBe("1500"); // JPY no tiene decimales
    expect(toMinor("1,23456789", 8)).toBe("123456789"); // BTC
  });

  it("mantiene el signo: una tarjeta puede arrancar con deuda", () => {
    expect(toMinor("-12,5", 2)).toBe("-1250");
    expect(toMinor("-0,05", 2)).toBe("-5");
    expect(toMinor("-,5", 2)).toBe("-50");
  });

  it("no pierde precisión donde el float la perdería", () => {
    // 8.29 * 100 da 828.9999... en coma flotante: con Math.round sale bien,
    // con un truncado sale 828. Acá es aritmética de enteros y no hay caso.
    expect(toMinor("8,29", 2)).toBe("829");
    expect(toMinor("1,005", 2)).toBe("100");
    expect(toMinor("70,7", 2)).toBe("7070");
  });

  it("aguanta importes más grandes que Number.MAX_SAFE_INTEGER", () => {
    expect(toMinor("999999999999999999999,99", 2)).toBe(
      "99999999999999999999999",
    );
  });

  it("ignora los espacios de los costados", () => {
    expect(toMinor("  12,5  ", 2)).toBe("1250");
  });
});

describe("minorToInput", () => {
  it("es el camino de vuelta de toMinor", () => {
    for (const [text, exponent] of [
      ["12.50", 2],
      ["-1250.99", 2],
      ["0.05", 2],
      ["1500", 0],
      ["1.23456789", 8],
    ] as const) {
      expect(minorToInput(toMinor(text, exponent), exponent)).toBe(text);
    }
  });

  it("devuelve algo editable, no algo formateado", () => {
    // Sin separador de miles: el siguiente tecleo lo rompería.
    expect(minorToInput("123456789", 2)).toBe("1234567.89");
  });

  it("no se come el cero de las unidades", () => {
    expect(minorToInput("5", 2)).toBe("0.05");
    expect(minorToInput("0", 2)).toBe("0.00");
    expect(minorToInput("-5", 2)).toBe("-0.05");
  });

  it("sin decimales no agrega punto", () => {
    expect(minorToInput("1500", 0)).toBe("1500");
  });
});

describe("isAmountInput", () => {
  it("acepta lo que toMinor sabe leer", () => {
    for (const value of ["0", "12", "12,5", "12.5", "-3", "-0,05", ",5", "5,"])
      expect(isAmountInput(value)).toBe(true);
  });

  it("rechaza lo que haría explotar a BigInt", () => {
    for (const value of ["", "  ", "abc", "1e3", "1,2,3", "-", "1 2", "$5"])
      expect(isAmountInput(value)).toBe(false);
  });
});
