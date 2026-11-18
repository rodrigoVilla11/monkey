import { describe, expect, it } from "vitest";

import {
  buildWorkbook,
  type ExportRow,
  type WorkbookInput,
} from "@/server/services/import-export/xlsx";

/**
 * El libro de Excel se arma con una función pura sobre filas ya leídas: acá
 * se verifica qué hojas salen y qué números llevan, sin base ni archivo.
 */

const row = (overrides: Partial<ExportRow>): ExportRow => ({
  id: "t1",
  type: "EXPENSE",
  status: "CLEARED",
  amountMinor: 1_050n, // 10,50 €
  currency: "EUR",
  amountPrimaryMinor: null,
  date: "2026-10-05",
  description: "Súper",
  payee: null,
  notes: null,
  createdByName: "Rodrigo",
  transferGroupId: null,
  transferDirection: null,
  account: "Banco",
  category: "Alimentación",
  subcategory: "Supermercado",
  tags: [],
  ...overrides,
});

const input = (rows: ExportRow[], extra: Partial<WorkbookInput> = {}) => ({
  rows,
  spaceName: "Casa",
  primaryCurrency: "EUR",
  locale: "es-ES",
  weekStartsOn: 1,
  today: "2026-10-19",
  range: { start: "2026-10-01", end: "2026-10-31" },
  accountName: null,
  ...extra,
});

/** Valor de una celda, venga como objeto o como valor pelado. */
const cell = (value: unknown): unknown =>
  value !== null && typeof value === "object" && "value" in value
    ? value.value
    : value;

const sheetNamed = (sheets: ReturnType<typeof buildWorkbook>, name: string) => {
  const sheet = sheets.find((s) => s.sheet === name);
  if (sheet === undefined) throw new Error(`falta la hoja ${name}`);
  return sheet;
};

describe("hojas del libro", () => {
  it("movimientos, resumen y categorías siempre; miembros solo si hay más de uno", () => {
    const solo = buildWorkbook(input([row({})]));
    expect(solo.map((s) => s.sheet)).toEqual([
      "Movimientos",
      "Resumen",
      "Por categoría",
    ]);

    const shared = buildWorkbook(
      input([row({}), row({ id: "t2", createdByName: "Ana" })]),
    );
    expect(shared.map((s) => s.sheet)).toContain("Por miembro");
  });
});

describe("hoja de movimientos", () => {
  it("una fila por movimiento, con importes numéricos y con signo", () => {
    const sheets = buildWorkbook(
      input([
        row({}),
        row({
          id: "t2",
          type: "INCOME",
          amountMinor: 200_000n,
          category: "Sueldo",
          subcategory: null,
        }),
        row({
          id: "t3",
          type: "TRANSFER",
          transferDirection: "OUT",
          transferGroupId: "g1",
          amountMinor: 5_000n,
          category: null,
          subcategory: null,
        }),
      ]),
    );
    const data = sheetNamed(sheets, "Movimientos").data;

    expect(data).toHaveLength(4); // cabecera + 3
    expect(cell(data[0]?.[0])).toBe("Fecha");

    const [, expense, income, transfer] = data;
    // Importe (col 2) y tipo (col 1).
    expect(cell(expense?.[1])).toBe("Gasto");
    expect(cell(expense?.[2])).toBe(-10.5);
    expect(cell(income?.[2])).toBe(2000);
    expect(cell(transfer?.[1])).toBe("Transferencia");
    expect(cell(transfer?.[2])).toBe(-50);
    expect(cell(transfer?.[13])).toBe("Salida");
    // La fecha es una fecha de Excel, no texto, y cae en el día correcto.
    const date = cell(expense?.[0]);
    expect(date).toBeInstanceOf(Date);
    expect((date as Date).getDate()).toBe(5);
    expect((date as Date).getMonth()).toBe(9);
  });

  it("usa la conversión congelada para la columna en moneda primaria", () => {
    const sheets = buildWorkbook(
      input([
        row({
          currency: "ARS",
          amountMinor: 1_500_000n, // 15.000 ARS
          amountPrimaryMinor: 1_305n, // 13,05 €
        }),
      ]),
    );
    const [, line] = sheetNamed(sheets, "Movimientos").data;

    expect(cell(line?.[2])).toBe(-15000);
    expect(cell(line?.[3])).toBe("ARS");
    expect(cell(line?.[4])).toBe(-13.05);
  });
});

describe("hoja de resumen", () => {
  it("los totales excluyen las transferencias y cuadran", () => {
    const sheets = buildWorkbook(
      input([
        row({ amountMinor: 3_000n }),
        row({ id: "t2", type: "INCOME", amountMinor: 10_000n }),
        row({
          id: "t3",
          type: "TRANSFER",
          transferDirection: "OUT",
          amountMinor: 99_999n,
        }),
      ]),
    );
    const data = sheetNamed(sheets, "Resumen").data;
    const total = data.find((r) => cell(r[0]) === "Total");

    expect(total?.map(cell)).toEqual(["Total", 100, 30, 70, 2]);
  });

  it("corta el período como los reportes: un mes, por día", () => {
    const sheets = buildWorkbook(input([row({})]));
    const data = sheetNamed(sheets, "Resumen").data;
    const headerIndex = data.findIndex((r) => cell(r[0]) === "Por día");

    expect(headerIndex).toBeGreaterThan(0);
    // 31 días de octubre debajo de la cabecera.
    expect(data.length - headerIndex - 1).toBe(31);
    const day5 = data[headerIndex + 5];
    expect(cell(day5?.[0])).toBe("Lun, 5 oct");
    expect(cell(day5?.[2])).toBe(10.5);
  });

  it("sin rango pedido, toma el que cubren las filas", () => {
    const sheets = buildWorkbook(
      input(
        [row({ date: "2025-11-03" }), row({ id: "t2", date: "2026-10-05" })],
        { range: null },
      ),
    );
    const data = sheetNamed(sheets, "Resumen").data;
    const period = data.find((r) => cell(r[0]) === "Período");

    expect(cell(period?.[1])).toBe("3 nov 2025 – 5 oct 2026");
    // Casi un año: por mes.
    expect(data.some((r) => cell(r[0]) === "Por mes")).toBe(true);
  });
});

describe("hoja por categoría", () => {
  it("agrupa bajo el padre y lista las hijas debajo, con porcentaje del tipo", () => {
    const sheets = buildWorkbook(
      input([
        row({ amountMinor: 6_000n }), // Alimentación > Supermercado
        row({ id: "t2", amountMinor: 2_000n, subcategory: "Restaurantes" }),
        row({
          id: "t3",
          amountMinor: 2_000n,
          category: "Transporte",
          subcategory: null,
        }),
        row({
          id: "t4",
          type: "INCOME",
          amountMinor: 50_000n,
          category: "Sueldo",
          subcategory: null,
        }),
      ]),
    );
    const data = sheetNamed(sheets, "Por categoría").data.map((r) =>
      r.map(cell),
    );

    expect(data[1]).toEqual(["Gasto", "Alimentación", null, 80, 0.8, 2]);
    expect(data[2]).toEqual([
      "Gasto",
      "Alimentación",
      "Supermercado",
      60,
      0.6,
      1,
    ]);
    expect(data[3]).toEqual([
      "Gasto",
      "Alimentación",
      "Restaurantes",
      20,
      0.2,
      1,
    ]);
    expect(data[4]).toEqual(["Gasto", "Transporte", null, 20, 0.2, 1]);
    expect(data[5]).toEqual(["Ingreso", "Sueldo", null, 500, 1, 1]);
  });

  it("lo que no tiene categoría también aparece", () => {
    const sheets = buildWorkbook(
      input([row({ category: null, subcategory: null })]),
    );
    const data = sheetNamed(sheets, "Por categoría").data;

    expect(cell(data[1]?.[1])).toBe("Sin categoría");
  });
});
