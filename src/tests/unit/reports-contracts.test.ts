import { describe, expect, it } from "vitest";

import {
  categoryReportQuerySchema,
  comparisonQuerySchema,
  seriesReportQuerySchema,
} from "@/shared/contracts/reports-v2";

/**
 * Lo que la API rechaza con 400 antes de tocar la base. Las reglas del rango
 * son las mismas en los cuatro endpoints —vienen de un solo helper— y acá se
 * verifica que de verdad lleguen a cada schema.
 */

const path = (result: {
  success: boolean;
  error?: { issues: { path: PropertyKey[] }[] };
}) => (result.success ? null : (result.error?.issues[0]?.path.join(".") ?? ""));

describe("reglas del rango, en cada reporte", () => {
  const schemas = {
    categorías: categoryReportQuerySchema,
    serie: seriesReportQuerySchema,
    comparativa: comparisonQuerySchema,
  };

  for (const [name, schema] of Object.entries(schemas)) {
    describe(name, () => {
      it("acepta sin rango y con rango completo", () => {
        expect(schema.safeParse({}).success).toBe(true);
        expect(
          schema.safeParse({ from: "2026-10-01", to: "2026-10-31" }).success,
        ).toBe(true);
      });

      it("rechaza un extremo solo", () => {
        // Antes `from` solo caía al fin del mes actual y disparaba una
        // consulta de años sin tope.
        expect(path(schema.safeParse({ from: "2020-01-01" }))).toBe("to");
        expect(path(schema.safeParse({ to: "2026-10-31" }))).toBe("to");
      });

      it("rechaza un rango al revés", () => {
        expect(
          path(schema.safeParse({ from: "2027-01-01", to: "2026-10-31" })),
        ).toBe("to");
      });

      it("rechaza más de 36 meses", () => {
        expect(
          path(schema.safeParse({ from: "2023-12-31", to: "2026-12-31" })),
        ).toBe("to");
        expect(
          schema.safeParse({ from: "2024-01-01", to: "2026-12-31" }).success,
        ).toBe(true);
      });

      it("rechaza fechas que no existen", () => {
        expect(
          schema.safeParse({ from: "2026-02-30", to: "2026-03-01" }).success,
        ).toBe(false);
      });
    });
  }
});

describe("serie", () => {
  it("convierte months desde la query y lo acota", () => {
    expect(seriesReportQuerySchema.parse({ months: "6" }).months).toBe(6);
    expect(seriesReportQuerySchema.safeParse({ months: "0" }).success).toBe(
      false,
    );
    expect(seriesReportQuerySchema.safeParse({ months: "25" }).success).toBe(
      false,
    );
  });

  it("el corte por defecto es automático", () => {
    expect(
      seriesReportQuerySchema.parse({ from: "2026-10-01", to: "2026-10-31" })
        .granularity,
    ).toBe("auto");
  });

  it("solo admite los cortes que el rango permite", () => {
    const month = { from: "2026-10-01", to: "2026-10-31" };
    expect(
      seriesReportQuerySchema.safeParse({ ...month, granularity: "week" })
        .success,
    ).toBe(true);
    // Un mes "por mes" sería una sola barra.
    expect(
      path(
        seriesReportQuerySchema.safeParse({ ...month, granularity: "month" }),
      ),
    ).toBe("granularity");
    // Tres años por día serían mil puntos.
    expect(
      path(
        seriesReportQuerySchema.safeParse({
          from: "2024-01-01",
          to: "2026-12-31",
          granularity: "day",
        }),
      ),
    ).toBe("granularity");
    expect(
      seriesReportQuerySchema.safeParse({ granularity: "banana" }).success,
    ).toBe(false);
  });
});

describe("comparativa", () => {
  it("por defecto compara contra el período anterior", () => {
    expect(comparisonQuerySchema.parse({ month: "2026-10-05" }).against).toBe(
      "previous",
    );
    expect(comparisonQuerySchema.parse({}).kind).toBe("EXPENSE");
  });

  it("acepta comparar contra el año anterior", () => {
    expect(
      comparisonQuerySchema.parse({
        from: "2026-10-01",
        to: "2026-10-31",
        against: "year",
      }).against,
    ).toBe("year");
    expect(comparisonQuerySchema.safeParse({ against: "decade" }).success).toBe(
      false,
    );
  });
});
