import { describe, expect, it } from "vitest";

import {
  describeRecurrence,
  firstOccurrence,
  nextOccurrence,
  occurrenceAt,
  occurrencesUpTo,
  validateRecurrence,
  type RecurrenceSpec,
} from "@/shared/recurrence";

/**
 * Motor de recurrencia.
 *
 * El test que más importa de este archivo es el de la deriva: "cada mes el 31"
 * tiene que volver al 31 después de pasar por febrero. Calculado desde la
 * ocurrencia anterior en vez de desde el ancla, la regla se muda sola al 28 y
 * nadie se entera hasta marzo.
 */

const spec = (over: Partial<RecurrenceSpec>): RecurrenceSpec => ({
  frequency: "MONTHLY",
  interval: 1,
  startDate: "2026-01-15",
  ...over,
});

describe("primera ocurrencia", () => {
  it("diaria: es la fecha de inicio", () => {
    expect(
      firstOccurrence(spec({ frequency: "DAILY", startDate: "2026-03-10" })),
    ).toBe("2026-03-10");
  });

  it("semanal: avanza hasta el primer día de la semana pedido", () => {
    // 2026-03-10 es martes; el primer viernes (5) es el 13.
    expect(
      firstOccurrence(
        spec({ frequency: "WEEKLY", startDate: "2026-03-10", byWeekday: 5 }),
      ),
    ).toBe("2026-03-13");
  });

  it("semanal: si el inicio ya cae en ese día, es el inicio", () => {
    // 2026-03-13 es viernes.
    expect(
      firstOccurrence(
        spec({ frequency: "WEEKLY", startDate: "2026-03-13", byWeekday: 5 }),
      ),
    ).toBe("2026-03-13");
  });

  it("mensual: si el día ya pasó, arranca el mes siguiente", () => {
    expect(
      firstOccurrence(spec({ startDate: "2026-03-20", byMonthDay: 5 })),
    ).toBe("2026-04-05");
  });

  it("mensual: si el día todavía no llegó, es de este mes", () => {
    expect(
      firstOccurrence(spec({ startDate: "2026-03-01", byMonthDay: 5 })),
    ).toBe("2026-03-05");
  });

  it("anual: salta al año siguiente si la fecha ya pasó", () => {
    expect(
      firstOccurrence(
        spec({
          frequency: "YEARLY",
          startDate: "2026-06-01",
          byMonth: 3,
          byMonthDay: 12,
        }),
      ),
    ).toBe("2027-03-12");
  });
});

describe("la regla no deriva", () => {
  it('"cada mes el 31" vuelve al 31 después de febrero', () => {
    const rule = spec({ startDate: "2026-01-31", byMonthDay: 31 });

    const dates = [0, 1, 2, 3, 4].map((index) => occurrenceAt(rule, index));

    expect(dates).toEqual([
      "2026-01-31",
      "2026-02-28", // febrero no tiene 31: se satura
      "2026-03-31", // y marzo vuelve al 31
      "2026-04-30",
      "2026-05-31",
    ]);
  });

  it("lo mismo encadenando con nextOccurrence", () => {
    const rule = spec({ startDate: "2026-01-31", byMonthDay: 31 });

    let current = firstOccurrence(rule);
    const dates = [current];
    for (let i = 0; i < 4; i += 1) {
      const next = nextOccurrence(rule, current);
      if (next === null) break;
      current = next;
      dates.push(current);
    }

    expect(dates).toEqual([
      "2026-01-31",
      "2026-02-28",
      "2026-03-31",
      "2026-04-30",
      "2026-05-31",
    ]);
  });

  it("el 29 de febrero de un bisiesto sobrevive al año siguiente", () => {
    const rule = spec({
      frequency: "YEARLY",
      startDate: "2028-02-29",
      byMonth: 2,
      byMonthDay: 29,
    });

    expect(occurrenceAt(rule, 0)).toBe("2028-02-29");
    expect(occurrenceAt(rule, 1)).toBe("2029-02-28");
    expect(occurrenceAt(rule, 4)).toBe("2032-02-29");
  });
});

describe("intervalos", () => {
  it("cada 2 semanas", () => {
    const rule = spec({
      frequency: "WEEKLY",
      interval: 2,
      startDate: "2026-03-13",
      byWeekday: 5,
    });

    expect([0, 1, 2].map((i) => occurrenceAt(rule, i))).toEqual([
      "2026-03-13",
      "2026-03-27",
      "2026-04-10",
    ]);
  });

  it("cada 3 días", () => {
    const rule = spec({
      frequency: "DAILY",
      interval: 3,
      startDate: "2026-03-01",
    });

    expect([0, 1, 2].map((i) => occurrenceAt(rule, i))).toEqual([
      "2026-03-01",
      "2026-03-04",
      "2026-03-07",
    ]);
  });

  it("cada 3 meses", () => {
    const rule = spec({ interval: 3, startDate: "2026-01-10" });

    expect([0, 1, 2].map((i) => occurrenceAt(rule, i))).toEqual([
      "2026-01-10",
      "2026-04-10",
      "2026-07-10",
    ]);
  });
});

describe("límites", () => {
  it("endDate corta la serie", () => {
    const rule = spec({ startDate: "2026-01-10", endDate: "2026-03-31" });

    expect(nextOccurrence(rule, "2026-02-10")).toBe("2026-03-10");
    expect(nextOccurrence(rule, "2026-03-10")).toBeNull();
  });

  it("maxOccurrences corta la serie", () => {
    const rule = spec({ startDate: "2026-01-10", maxOccurrences: 3 });

    expect(nextOccurrence(rule, "2026-01-10")).toBe("2026-02-10");
    expect(nextOccurrence(rule, "2026-02-10")).toBe("2026-03-10");
    // La tercera fue la del 10 de marzo: no hay cuarta.
    expect(nextOccurrence(rule, "2026-03-10")).toBeNull();
  });
});

describe("ventana de ocurrencias", () => {
  it("trae todas las vencidas cuando el job estuvo caído", () => {
    // Regla mensual el 1. El job no corrió desde enero y hoy es 20 de abril.
    const rule = spec({ startDate: "2026-01-01", byMonthDay: 1 });
    const window = occurrencesUpTo(rule, "2026-01-01", "2026-04-20", 50);

    expect(window.dates).toEqual([
      "2026-01-01",
      "2026-02-01",
      "2026-03-01",
      "2026-04-01",
    ]);
    expect(window.truncated).toBe(false);
    expect(window.next).toBe("2026-05-01");
  });

  it("cada ocurrencia conserva SU fecha, no la de hoy", () => {
    const rule = spec({ startDate: "2026-01-01", byMonthDay: 1 });
    const window = occurrencesUpTo(rule, "2026-01-01", "2026-04-20", 50);

    // Lo que sostiene que los reportes mensuales no se corrompan al recuperar
    // un atraso: el alquiler de enero se fecha en enero.
    expect(window.dates.every((date) => date.endsWith("-01"))).toBe(true);
  });

  it("el tope recorta sin saltear: lo que queda es lo siguiente a hacer", () => {
    // Regla diaria caída dos meses.
    const rule = spec({ frequency: "DAILY", startDate: "2026-01-01" });
    const window = occurrencesUpTo(rule, "2026-01-01", "2026-03-01", 10);

    expect(window.dates).toHaveLength(10);
    expect(window.dates[0]).toBe("2026-01-01");
    expect(window.dates[9]).toBe("2026-01-10");
    expect(window.truncated).toBe(true);
    // La corrida siguiente arranca justo donde esta cortó: nada se pierde.
    expect(window.next).toBe("2026-01-11");
  });

  it("no devuelve nada si todavía no venció ninguna", () => {
    const rule = spec({ startDate: "2026-06-01", byMonthDay: 1 });
    const window = occurrencesUpTo(rule, "2026-06-01", "2026-04-20", 50);

    expect(window.dates).toEqual([]);
    expect(window.truncated).toBe(false);
    expect(window.next).toBe("2026-06-01");
  });

  it("respeta endDate dentro de la ventana", () => {
    const rule = spec({
      startDate: "2026-01-01",
      byMonthDay: 1,
      endDate: "2026-02-28",
    });
    const window = occurrencesUpTo(rule, "2026-01-01", "2026-12-31", 50);

    expect(window.dates).toEqual(["2026-01-01", "2026-02-01"]);
    expect(window.next).toBeNull();
  });

  it("arranca desde `from` aunque el ancla sea mucho más vieja", () => {
    const rule = spec({ startDate: "2020-01-10" });
    const window = occurrencesUpTo(rule, "2026-03-01", "2026-05-31", 50);

    expect(window.dates).toEqual(["2026-03-10", "2026-04-10", "2026-05-10"]);
  });
});

describe("validación", () => {
  it("acepta una regla razonable", () => {
    expect(validateRecurrence(spec({ byMonthDay: 1 }))).toEqual([]);
  });

  it("rechaza intervalos inválidos", () => {
    expect(validateRecurrence(spec({ interval: 0 })).length).toBeGreaterThan(0);
    expect(validateRecurrence(spec({ interval: 1.5 })).length).toBeGreaterThan(
      0,
    );
    expect(validateRecurrence(spec({ interval: 400 })).length).toBeGreaterThan(
      0,
    );
  });

  it("rechaza días y meses fuera de rango", () => {
    expect(validateRecurrence(spec({ byMonthDay: 0 })).length).toBeGreaterThan(
      0,
    );
    expect(validateRecurrence(spec({ byMonthDay: 32 })).length).toBeGreaterThan(
      0,
    );
    expect(validateRecurrence(spec({ byMonth: 13 })).length).toBeGreaterThan(0);
    expect(
      validateRecurrence(spec({ frequency: "WEEKLY", byWeekday: 7 })).length,
    ).toBeGreaterThan(0);
  });

  it("rechaza un fin anterior al inicio", () => {
    expect(
      validateRecurrence(
        spec({ startDate: "2026-05-01", endDate: "2026-04-01" }),
      ).length,
    ).toBeGreaterThan(0);
  });
});

describe("descripción", () => {
  it("dice la regla en una línea", () => {
    expect(describeRecurrence(spec({ frequency: "DAILY" }))).toBe(
      "Todos los días",
    );
    expect(describeRecurrence(spec({ frequency: "DAILY", interval: 3 }))).toBe(
      "Cada 3 días",
    );
    expect(
      describeRecurrence(
        spec({ frequency: "WEEKLY", byWeekday: 5, startDate: "2026-03-13" }),
      ),
    ).toBe("Todos los viernes");
    expect(describeRecurrence(spec({ byMonthDay: 1 }))).toBe(
      "Todos los meses el día 1",
    );
    expect(
      describeRecurrence(
        spec({ frequency: "YEARLY", byMonth: 3, byMonthDay: 12 }),
      ),
    ).toBe("Todos los años el 12 de marzo");
  });

  it("avisa cuando el día puede saturarse", () => {
    // Que en febrero caiga el 28 no puede ser una sorpresa.
    expect(describeRecurrence(spec({ byMonthDay: 31 }))).toContain(
      "o el último del mes",
    );
  });
});
