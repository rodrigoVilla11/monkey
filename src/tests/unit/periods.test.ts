import { describe, expect, it } from "vitest";

import { addDays, type DateRange } from "@/shared/dates";
import {
  allowedGranularities,
  bucketKeyFor,
  bucketLabel,
  bucketsFor,
  bucketTitle,
  canStepForward,
  dayCount,
  describeRange,
  exceedsMaxRange,
  granularityFor,
  isSingleMonth,
  isWholeMonths,
  isWholeYear,
  lastMonthsRange,
  monthSpan,
  presetRange,
  previousRange,
  rangeFromQuery,
  sameRangeLastYear,
  shiftRange,
} from "@/shared/periods";

const TODAY = "2026-10-19"; // lunes

const range = (start: string, end: string): DateRange => ({ start, end });

describe("atajos", () => {
  it("este mes y el pasado son meses enteros", () => {
    expect(presetRange("this-month", TODAY)).toEqual(
      range("2026-10-01", "2026-10-31"),
    );
    expect(presetRange("last-month", TODAY)).toEqual(
      range("2026-09-01", "2026-09-30"),
    );
  });

  it("el mes pasado no se come un día cuando hoy es 31", () => {
    // 31 de marzo − 1 mes = 28 de febrero; el rango tiene que ser febrero
    // entero, no un trozo.
    expect(presetRange("last-month", "2026-03-31")).toEqual(
      range("2026-02-01", "2026-02-28"),
    );
  });

  it("los últimos N meses incluyen el actual entero", () => {
    expect(presetRange("last-3-months", TODAY)).toEqual(
      range("2026-08-01", "2026-10-31"),
    );
    expect(lastMonthsRange(TODAY, 12)).toEqual(
      range("2025-11-01", "2026-10-31"),
    );
    expect(lastMonthsRange(TODAY, 1)).toEqual(
      range("2026-10-01", "2026-10-31"),
    );
  });

  it("este año y el pasado", () => {
    expect(presetRange("this-year", TODAY)).toEqual(
      range("2026-01-01", "2026-12-31"),
    );
    expect(presetRange("last-year", TODAY)).toEqual(
      range("2025-01-01", "2025-12-31"),
    );
  });

  it("las semanas empiezan donde diga la preferencia", () => {
    // Lunes 19: con semana de lunes es la que arranca hoy; con semana de
    // domingo, la que arrancó ayer.
    expect(presetRange("this-week", TODAY, 1)).toEqual(
      range("2026-10-19", "2026-10-25"),
    );
    expect(presetRange("last-week", TODAY, 1)).toEqual(
      range("2026-10-12", "2026-10-18"),
    );
    expect(presetRange("this-week", TODAY, 0)).toEqual(
      range("2026-10-18", "2026-10-24"),
    );
  });
});

describe("forma del rango", () => {
  it("reconoce meses enteros, un mes y un año", () => {
    expect(isWholeMonths(range("2026-08-01", "2026-10-31"))).toBe(true);
    expect(isWholeMonths(range("2026-08-02", "2026-10-31"))).toBe(false);
    expect(isSingleMonth(range("2026-10-01", "2026-10-31"))).toBe(true);
    expect(isSingleMonth(range("2026-09-01", "2026-10-31"))).toBe(false);
    expect(isWholeYear(range("2026-01-01", "2026-12-31"))).toBe(true);
    expect(isWholeYear(range("2026-01-01", "2027-12-31"))).toBe(false);
  });

  it("cuenta los meses que toca, no los que caben", () => {
    expect(monthSpan(range("2026-01-15", "2026-01-20"))).toBe(1);
    expect(monthSpan(range("2025-12-31", "2026-01-01"))).toBe(2);
    expect(monthSpan(range("2024-01-01", "2026-12-31"))).toBe(36);
  });

  it("36 meses es el tope", () => {
    expect(exceedsMaxRange(range("2024-01-01", "2026-12-31"))).toBe(false);
    expect(exceedsMaxRange(range("2023-12-31", "2026-12-31"))).toBe(true);
  });

  it("dayCount es inclusivo", () => {
    expect(dayCount(range("2026-10-01", "2026-10-01"))).toBe(1);
    expect(dayCount(range("2026-10-01", "2026-10-31"))).toBe(31);
  });

  it("toma el rango de la query o el de reserva", () => {
    const fallback = () => range("2026-10-01", "2026-10-31");
    expect(
      rangeFromQuery({ from: "2026-01-01", to: "2026-01-31" }, fallback),
    ).toEqual(range("2026-01-01", "2026-01-31"));
    expect(rangeFromQuery({}, fallback)).toEqual(fallback());
    // Un extremo solo no es un rango: lo rechaza el contrato antes, pero acá
    // tampoco se inventa el otro.
    expect(rangeFromQuery({ from: "2026-01-01" }, fallback)).toEqual(
      fallback(),
    );
  });
});

describe("correr el rango", () => {
  it("un mes pasa al mes vecino, aunque tenga otro largo", () => {
    expect(shiftRange(range("2026-10-01", "2026-10-31"), 1)).toEqual(
      range("2026-11-01", "2026-11-30"),
    );
    expect(shiftRange(range("2026-01-01", "2026-01-31"), -1)).toEqual(
      range("2025-12-01", "2025-12-31"),
    );
  });

  it("un trimestre pasa al trimestre vecino", () => {
    expect(previousRange(range("2026-08-01", "2026-10-31"))).toEqual(
      range("2026-05-01", "2026-07-31"),
    );
  });

  it("un año pasa al año vecino", () => {
    expect(previousRange(range("2026-01-01", "2026-12-31"))).toEqual(
      range("2025-01-01", "2025-12-31"),
    );
  });

  it("un rango suelto se corre su propio largo en días", () => {
    // 14 días: del 6 al 19. El anterior termina el 5 y empieza 14 días antes.
    expect(previousRange(range("2026-10-06", "2026-10-19"))).toEqual(
      range("2026-09-22", "2026-10-05"),
    );
    expect(shiftRange(range("2026-10-06", "2026-10-19"), 1)).toEqual(
      range("2026-10-20", "2026-11-02"),
    );
  });

  it("ir y volver deja el rango donde estaba", () => {
    const samples = [
      range("2026-10-01", "2026-10-31"),
      range("2026-08-01", "2026-10-31"),
      range("2026-10-06", "2026-10-19"),
    ];
    for (const sample of samples) {
      expect(shiftRange(shiftRange(sample, -1), 1)).toEqual(sample);
    }
  });

  it("el mismo período del año pasado", () => {
    expect(sameRangeLastYear(range("2026-10-01", "2026-10-31"))).toEqual(
      range("2025-10-01", "2025-10-31"),
    );
    // Febrero entero de un bisiesto → febrero entero del año anterior.
    expect(sameRangeLastYear(range("2024-02-01", "2024-02-29"))).toEqual(
      range("2023-02-01", "2023-02-28"),
    );
    // Un rango suelto se corre un año por extremo; el 29 satura al 28.
    expect(sameRangeLastYear(range("2024-02-20", "2024-02-29"))).toEqual(
      range("2023-02-20", "2023-02-28"),
    );
    expect(sameRangeLastYear(range("2026-10-06", "2026-10-19"))).toEqual(
      range("2025-10-06", "2025-10-19"),
    );
  });

  it("se puede avanzar al mes en curso pero no a días que no pasaron", () => {
    // Meses enteros: el siguiente puede ser el actual, aunque no terminó.
    expect(canStepForward(range("2026-09-01", "2026-09-30"), TODAY)).toBe(true);
    expect(canStepForward(range("2026-10-01", "2026-10-31"), TODAY)).toBe(
      false,
    );
    // Rango suelto: solo si el siguiente ya pasó entero.
    expect(canStepForward(range("2026-09-01", "2026-09-14"), TODAY)).toBe(true);
    expect(canStepForward(range("2026-10-01", "2026-10-15"), TODAY)).toBe(
      false,
    );
  });
});

describe("corte de la serie", () => {
  it("hasta un mes por día, hasta 18 semanas por semana, el resto por mes", () => {
    expect(granularityFor(range("2026-10-01", "2026-10-31"))).toBe("day");
    expect(granularityFor(range("2026-10-01", "2026-11-01"))).toBe("week");
    expect(granularityFor(range("2026-01-01", "2026-05-06"))).toBe("week"); // 126
    expect(granularityFor(range("2026-01-01", "2026-05-07"))).toBe("month"); // 127
    expect(granularityFor(range("2025-11-01", "2026-10-31"))).toBe("month");
  });

  it("qué cortes se pueden pedir a mano, y el automático siempre está", () => {
    expect(allowedGranularities(range("2026-10-01", "2026-10-31"))).toEqual([
      "day",
      "week",
    ]);
    expect(allowedGranularities(range("2026-08-01", "2026-10-31"))).toEqual([
      "day",
      "week",
      "month",
    ]);
    expect(allowedGranularities(range("2026-07-01", "2026-10-31"))).toEqual([
      "week",
      "month",
    ]);
    expect(allowedGranularities(range("2025-11-01", "2026-10-31"))).toEqual([
      "week",
      "month",
    ]);
    expect(allowedGranularities(range("2024-01-01", "2026-12-31"))).toEqual([
      "month",
    ]);

    for (const sample of [
      range("2026-10-01", "2026-10-31"),
      range("2026-08-01", "2026-10-31"),
      range("2025-11-01", "2026-10-31"),
      range("2024-01-01", "2026-12-31"),
    ]) {
      expect(allowedGranularities(sample)).toContain(granularityFor(sample));
    }
  });

  it("por día: un corte por fecha", () => {
    const buckets = bucketsFor(range("2026-10-01", "2026-10-31"), "day", 1);

    expect(buckets).toHaveLength(31);
    expect(buckets[0]).toEqual({
      key: "2026-10-01",
      start: "2026-10-01",
      end: "2026-10-01",
    });
    expect(buckets.at(-1)?.key).toBe("2026-10-31");
  });

  it("por semana: la primera y la última se recortan al rango", () => {
    // Del miércoles 14 de octubre al martes 10 de noviembre, semana de lunes.
    const buckets = bucketsFor(range("2026-10-14", "2026-11-10"), "week", 1);

    expect(buckets.map((b) => [b.start, b.end])).toEqual([
      ["2026-10-14", "2026-10-18"],
      ["2026-10-19", "2026-10-25"],
      ["2026-10-26", "2026-11-01"],
      ["2026-11-02", "2026-11-08"],
      ["2026-11-09", "2026-11-10"],
    ]);
    expect(buckets[0]?.key).toBe("2026-10-14");
  });

  it("por semana respeta el día en que empieza la semana", () => {
    // Semana de domingo: el sábado 17 cierra la primera.
    const buckets = bucketsFor(range("2026-10-14", "2026-10-31"), "week", 0);

    expect(buckets.map((b) => [b.start, b.end])).toEqual([
      ["2026-10-14", "2026-10-17"],
      ["2026-10-18", "2026-10-24"],
      ["2026-10-25", "2026-10-31"],
    ]);
  });

  it("por mes: la clave es el mes y los extremos se recortan", () => {
    const buckets = bucketsFor(range("2026-01-15", "2026-03-10"), "month", 1);

    expect(buckets.map((b) => b.key)).toEqual([
      "2026-01",
      "2026-02",
      "2026-03",
    ]);
    expect(buckets[0]?.start).toBe("2026-01-15");
    expect(buckets.at(-1)?.end).toBe("2026-03-10");
  });

  it("cada día del rango cae en el corte que dice bucketKeyFor", () => {
    // La misma regla vista desde el dato y desde el calendario tiene que
    // coincidir: si no, un movimiento se sumaría a una clave que no existe.
    const cases = [
      { r: range("2026-10-14", "2026-11-10"), g: "week", w: 1 },
      { r: range("2026-10-14", "2026-10-31"), g: "week", w: 0 },
      { r: range("2026-10-01", "2026-10-31"), g: "day", w: 1 },
      { r: range("2026-01-15", "2026-03-10"), g: "month", w: 1 },
    ] as const;

    for (const { r, g, w } of cases) {
      for (const bucket of bucketsFor(r, g, w)) {
        for (let day = bucket.start; day <= bucket.end; day = addDays(day, 1)) {
          expect(bucketKeyFor(day, r, g, w)).toBe(bucket.key);
        }
      }
    }
  });
});

describe("presentación en es-ES", () => {
  const locale = "es-ES";

  it("nombra el rango lo más corto posible", () => {
    expect(describeRange(range("2026-10-01", "2026-10-31"), locale)).toBe(
      "Octubre de 2026",
    );
    expect(describeRange(range("2026-01-01", "2026-12-31"), locale)).toBe(
      "2026",
    );
    expect(describeRange(range("2026-08-01", "2026-10-31"), locale)).toBe(
      "ago – oct 2026",
    );
    expect(describeRange(range("2025-10-01", "2026-03-31"), locale)).toBe(
      "oct 2025 – mar 2026",
    );
    expect(describeRange(range("2026-10-06", "2026-10-19"), locale)).toBe(
      "6 oct – 19 oct 2026",
    );
    expect(describeRange(range("2025-12-28", "2026-01-06"), locale)).toBe(
      "28 dic 2025 – 6 ene 2026",
    );
  });

  it("etiqueta y título de cada corte", () => {
    const month = range("2026-10-01", "2026-10-31");
    expect(bucketLabel(month, "month", locale)).toBe("oct 26");
    expect(bucketTitle(month, "month", locale)).toBe("Octubre de 2026");

    const day = range("2026-10-05", "2026-10-05");
    expect(bucketLabel(day, "day", locale)).toBe("5 oct");
    expect(bucketTitle(day, "day", locale)).toBe("Lun, 5 oct");

    const week = range("2026-10-05", "2026-10-11");
    expect(bucketLabel(week, "week", locale)).toBe("5 oct");
    expect(bucketTitle(week, "week", locale)).toBe("5 oct – 11 oct");
  });

  it("una semana que cruza el año lo dice, y una de un día se nombra como día", () => {
    expect(bucketTitle(range("2025-12-29", "2026-01-04"), "week", locale)).toBe(
      "29 dic 2025 – 4 ene 2026",
    );
    expect(bucketTitle(range("2026-11-09", "2026-11-09"), "week", locale)).toBe(
      "Lun, 9 nov",
    );
  });
});
