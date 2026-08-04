import { describe, expect, it } from "vitest";

import {
  addDays,
  addMonths,
  addYears,
  compareCalendarDates,
  daysInMonth,
  differenceInDays,
  endOfMonth,
  formatCalendarDate,
  formatInstant,
  fromCalendarDate,
  getWeekday,
  isCalendarDate,
  isLeapYear,
  isValidTimeZone,
  isWithin,
  lastMonths,
  monthRange,
  startOfMonth,
  startOfWeek,
  toCalendarDate,
  todayIn,
  weekRange,
} from "@/shared/dates";

describe("isCalendarDate", () => {
  it("acepta fechas reales", () => {
    expect(isCalendarDate("2026-08-04")).toBe(true);
    expect(isCalendarDate("2024-02-29")).toBe(true); // bisiesto
  });

  it("rechaza formatos y fechas inexistentes", () => {
    expect(isCalendarDate("2026-2-4")).toBe(false);
    expect(isCalendarDate("2026/08/04")).toBe(false);
    expect(isCalendarDate("2026-13-01")).toBe(false);
    expect(isCalendarDate("2026-00-01")).toBe(false);
    expect(isCalendarDate("2026-02-30")).toBe(false);
    expect(isCalendarDate("2025-02-29")).toBe(false); // no bisiesto
    expect(isCalendarDate("2026-04-31")).toBe(false);
    expect(isCalendarDate("")).toBe(false);
  });
});

describe("años bisiestos", () => {
  it("aplica la regla completa, no solo el módulo 4", () => {
    expect(isLeapYear(2024)).toBe(true);
    expect(isLeapYear(2025)).toBe(false);
    expect(isLeapYear(1900)).toBe(false); // divisible por 100
    expect(isLeapYear(2000)).toBe(true); // divisible por 400
  });

  it("cuenta bien los días de febrero", () => {
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2025, 2)).toBe(28);
    expect(daysInMonth(1900, 2)).toBe(28);
    expect(daysInMonth(2000, 2)).toBe(29);
    expect(daysInMonth(2026, 12)).toBe(31);
    expect(daysInMonth(2026, 4)).toBe(30);
  });
});

describe("conversión con Date", () => {
  it("usa componentes UTC, no locales", () => {
    // Prisma devuelve las columnas @db.Date a medianoche UTC.
    const date = new Date(Date.UTC(2026, 7, 4));
    expect(toCalendarDate(date)).toBe("2026-08-04");
  });

  it("construye a medianoche UTC", () => {
    const date = fromCalendarDate("2026-08-04");
    expect(date.toISOString()).toBe("2026-08-04T00:00:00.000Z");
  });

  it("hace ida y vuelta sin correrse un día", () => {
    // Este es EL bug clásico: con aritmética local, en un huso negativo
    // 2026-01-01 vuelve como 2025-12-31.
    for (const value of [
      "2026-01-01",
      "2026-06-15",
      "2026-12-31",
      "2024-02-29",
    ]) {
      expect(toCalendarDate(fromCalendarDate(value))).toBe(value);
    }
  });

  it("tira con una fecha mal formada", () => {
    expect(() => fromCalendarDate("no-es-fecha")).toThrow(RangeError);
  });
});

describe("todayIn", () => {
  it("da días distintos según la timezone en el mismo instante", () => {
    // 2026-08-04 23:30 UTC: en Madrid (UTC+2) ya es el 5.
    const instant = new Date("2026-08-04T23:30:00Z");
    expect(todayIn("UTC", instant)).toBe("2026-08-04");
    expect(todayIn("Europe/Madrid", instant)).toBe("2026-08-05");
    expect(todayIn("America/Argentina/Buenos_Aires", instant)).toBe(
      "2026-08-04",
    );
  });

  it("resuelve el cruce de medianoche del lado del usuario", () => {
    // 2026-08-05 01:30 UTC: en Buenos Aires (UTC−3) todavía es el 4.
    const instant = new Date("2026-08-05T01:30:00Z");
    expect(todayIn("Europe/Madrid", instant)).toBe("2026-08-05");
    expect(todayIn("America/Argentina/Buenos_Aires", instant)).toBe(
      "2026-08-04",
    );
  });

  it("cae en UTC si la timezone es inválida", () => {
    const instant = new Date("2026-08-04T12:00:00Z");
    expect(todayIn("Marte/Olympus", instant)).toBe("2026-08-04");
  });

  it("valida timezones IANA", () => {
    expect(isValidTimeZone("Europe/Madrid")).toBe(true);
    expect(isValidTimeZone("America/Argentina/Buenos_Aires")).toBe(true);
    expect(isValidTimeZone("Europe/Madriz")).toBe(false);
  });
});

describe("addDays", () => {
  it("suma y resta cruzando meses y años", () => {
    expect(addDays("2026-08-04", 1)).toBe("2026-08-05");
    expect(addDays("2026-08-31", 1)).toBe("2026-09-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(addDays("2026-08-04", 0)).toBe("2026-08-04");
  });

  it("cruza el 29 de febrero", () => {
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(addDays("2025-02-28", 1)).toBe("2025-03-01");
  });
});

describe("addMonths", () => {
  it("satura al último día del mes destino", () => {
    // Un gasto recurrente el 31 no puede saltar al 3 de marzo.
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2024-01-31", 1)).toBe("2024-02-29");
    expect(addMonths("2026-03-31", 1)).toBe("2026-04-30");
    expect(addMonths("2026-05-31", 1)).toBe("2026-06-30");
  });

  it("suma meses normales", () => {
    expect(addMonths("2026-08-04", 1)).toBe("2026-09-04");
    expect(addMonths("2026-08-04", 12)).toBe("2027-08-04");
  });

  it("resta meses cruzando el año", () => {
    expect(addMonths("2026-01-15", -1)).toBe("2025-12-15");
    expect(addMonths("2026-01-15", -13)).toBe("2024-12-15");
    expect(addMonths("2026-03-31", -1)).toBe("2026-02-28");
  });

  it("no es reversible cuando saturó, y eso es correcto", () => {
    // 31 ene +1 mes = 28 feb; 28 feb −1 mes = 28 ene, no 31.
    const forward = addMonths("2026-01-31", 1);
    expect(forward).toBe("2026-02-28");
    expect(addMonths(forward, -1)).toBe("2026-01-28");
  });

  it("suma años", () => {
    expect(addYears("2026-08-04", 1)).toBe("2027-08-04");
    expect(addYears("2024-02-29", 1)).toBe("2025-02-28");
  });
});

describe("differenceInDays", () => {
  it("cuenta días calendario", () => {
    expect(differenceInDays("2026-08-04", "2026-08-05")).toBe(1);
    expect(differenceInDays("2026-08-05", "2026-08-04")).toBe(-1);
    expect(differenceInDays("2026-08-04", "2026-08-04")).toBe(0);
    expect(differenceInDays("2026-01-01", "2027-01-01")).toBe(365);
    expect(differenceInDays("2024-01-01", "2025-01-01")).toBe(366);
  });

  it("no se rompe con el cambio de horario", () => {
    // En Madrid el 29/03/2026 tiene 23 horas. Como CalendarDate son días
    // enteros, esto tiene que dar 1 igual.
    expect(differenceInDays("2026-03-28", "2026-03-29")).toBe(1);
    expect(differenceInDays("2026-03-01", "2026-04-01")).toBe(31);
  });
});

describe("períodos", () => {
  it("calcula el mes", () => {
    expect(startOfMonth("2026-08-04")).toBe("2026-08-01");
    expect(endOfMonth("2026-08-04")).toBe("2026-08-31");
    expect(endOfMonth("2026-02-10")).toBe("2026-02-28");
    expect(endOfMonth("2024-02-10")).toBe("2024-02-29");
    expect(monthRange("2026-08-04")).toEqual({
      start: "2026-08-01",
      end: "2026-08-31",
    });
  });

  it("calcula la semana respetando el primer día configurado", () => {
    // 2026-08-04 es martes.
    expect(getWeekday("2026-08-04")).toBe(2);
    expect(startOfWeek("2026-08-04", 1)).toBe("2026-08-03"); // lunes
    expect(startOfWeek("2026-08-04", 0)).toBe("2026-08-02"); // domingo
    expect(startOfWeek("2026-08-04", 6)).toBe("2026-08-01"); // sábado
  });

  it("no mueve la fecha si ya es el primer día de la semana", () => {
    expect(startOfWeek("2026-08-03", 1)).toBe("2026-08-03");
  });

  it("devuelve rangos semanales de 7 días", () => {
    expect(weekRange("2026-08-04", 1)).toEqual({
      start: "2026-08-03",
      end: "2026-08-09",
    });
  });

  it("comprueba pertenencia a un rango, inclusive en los bordes", () => {
    const range = monthRange("2026-08-04");
    expect(isWithin("2026-08-01", range)).toBe(true);
    expect(isWithin("2026-08-31", range)).toBe(true);
    expect(isWithin("2026-07-31", range)).toBe(false);
    expect(isWithin("2026-09-01", range)).toBe(false);
  });

  it("ordena fechas como strings", () => {
    expect(compareCalendarDates("2026-08-04", "2026-08-05")).toBe(-1);
    expect(compareCalendarDates("2026-08-05", "2026-08-04")).toBe(1);
    expect(compareCalendarDates("2026-08-04", "2026-08-04")).toBe(0);
    // El formato ISO ordena lexicográficamente, que es medio el punto de usarlo.
    expect(["2026-12-01", "2026-02-01", "2025-11-30"].sort()).toEqual([
      "2025-11-30",
      "2026-02-01",
      "2026-12-01",
    ]);
  });
});

describe("lastMonths", () => {
  it("devuelve N meses del más viejo al más nuevo, inclusive el actual", () => {
    const ranges = lastMonths("2026-08-04", 3);
    expect(ranges).toEqual([
      { start: "2026-06-01", end: "2026-06-30" },
      { start: "2026-07-01", end: "2026-07-31" },
      { start: "2026-08-01", end: "2026-08-31" },
    ]);
  });

  it("cruza el cambio de año", () => {
    const ranges = lastMonths("2026-01-15", 3);
    expect(ranges.map((r) => r.start)).toEqual([
      "2025-11-01",
      "2025-12-01",
      "2026-01-01",
    ]);
  });

  it("maneja el borde de un solo mes", () => {
    expect(lastMonths("2026-08-04", 1)).toEqual([
      { start: "2026-08-01", end: "2026-08-31" },
    ]);
  });
});

describe("presentación", () => {
  it("formatea la fecha en UTC para no correrse un día", () => {
    const formatted = formatCalendarDate("2026-08-04", "es-ES", {
      dateStyle: "short",
    });
    expect(formatted).toContain("4");
    expect(formatted).toContain("8");
  });

  it("respeta el locale", () => {
    const es = formatCalendarDate("2026-08-04", "es-ES", { month: "long" });
    const en = formatCalendarDate("2026-08-04", "en-US", { month: "long" });
    expect(es.toLowerCase()).toContain("agosto");
    expect(en.toLowerCase()).toContain("august");
  });

  it("muestra un instante en la timezone de quien mira", () => {
    const instant = new Date("2026-08-04T23:30:00Z");
    const madrid = formatInstant(instant, "Europe/Madrid", "es-ES");
    const buenosAires = formatInstant(
      instant,
      "America/Argentina/Buenos_Aires",
      "es-AR",
    );
    // Mismo instante, días distintos: 5 en Madrid, 4 en Buenos Aires.
    expect(madrid).toContain("5");
    expect(buenosAires).toContain("4");
  });

  it("se degrada sin romper con entradas inválidas", () => {
    expect(formatCalendarDate("2026-08-04", "xx-YY-zz")).toBe("2026-08-04");
    const instant = new Date("2026-08-04T12:00:00Z");
    expect(formatInstant(instant, "Marte/Olympus", "es-ES")).toContain("2026");
  });
});
