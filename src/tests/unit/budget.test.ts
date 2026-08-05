import { describe, expect, it } from "vitest";

import {
  budgetStatus,
  currentPeriod,
  elapsedPeriods,
  hasEnded,
  nextPeriodStart,
  WARNING_THRESHOLD,
} from "@/shared/budget";

describe("período en curso", () => {
  describe("mensual", () => {
    it("es el mes calendario, no 30 días desde que se creó", () => {
      // Es lo que quiere decir cualquiera con "presupuesto mensual", y hace
      // que coincida con el resumen del mes del dashboard.
      expect(
        currentPeriod("MONTHLY", "2026-01-10", null, "2026-03-15"),
      ).toEqual({
        start: "2026-03-01",
        end: "2026-03-31",
      });
    });

    it("el primer período arranca cuando arranca el presupuesto", () => {
      // Creado el 10 de marzo: el período de marzo va del 10 al 31, no
      // desde el 1 — no tendría sentido contar gastos previos a su creación.
      expect(
        currentPeriod("MONTHLY", "2026-03-10", null, "2026-03-15"),
      ).toEqual({
        start: "2026-03-10",
        end: "2026-03-31",
      });
    });

    it("respeta los meses cortos", () => {
      expect(
        currentPeriod("MONTHLY", "2026-01-01", null, "2026-02-14"),
      ).toEqual({
        start: "2026-02-01",
        end: "2026-02-28",
      });
      expect(
        currentPeriod("MONTHLY", "2024-01-01", null, "2024-02-14"),
      ).toEqual({
        start: "2024-02-01",
        end: "2024-02-29",
      });
    });

    it("si todavía no empezó, muestra su primer período", () => {
      expect(
        currentPeriod("MONTHLY", "2026-06-01", null, "2026-03-15"),
      ).toEqual({
        start: "2026-06-01",
        end: "2026-06-30",
      });
    });
  });

  describe("semanal", () => {
    it("son ventanas de 7 días ancladas al inicio", () => {
      // Anclado al startDate y no al weekStartsOn de cada persona: el
      // presupuesto es del Space y sus miembros pueden tener config distinta.
      // El mismo presupuesto no puede empezar en días diferentes según quién
      // lo mire.
      expect(currentPeriod("WEEKLY", "2026-03-04", null, "2026-03-04")).toEqual(
        {
          start: "2026-03-04",
          end: "2026-03-10",
        },
      );
      expect(currentPeriod("WEEKLY", "2026-03-04", null, "2026-03-10")).toEqual(
        {
          start: "2026-03-04",
          end: "2026-03-10",
        },
      );
      expect(currentPeriod("WEEKLY", "2026-03-04", null, "2026-03-11")).toEqual(
        {
          start: "2026-03-11",
          end: "2026-03-17",
        },
      );
    });

    it("acumula semanas correctamente a lo largo de meses", () => {
      expect(currentPeriod("WEEKLY", "2026-01-01", null, "2026-03-15")).toEqual(
        {
          start: "2026-03-12",
          end: "2026-03-18",
        },
      );
    });
  });

  it("el período fijo es uno solo, de punta a punta", () => {
    expect(
      currentPeriod("CUSTOM", "2026-03-01", "2026-06-30", "2026-04-15"),
    ).toEqual({ start: "2026-03-01", end: "2026-06-30" });
  });
});

describe("períodos transcurridos", () => {
  it("cuenta el actual", () => {
    expect(elapsedPeriods("MONTHLY", "2026-03-10", "2026-03-15")).toBe(1);
    expect(elapsedPeriods("MONTHLY", "2026-01-10", "2026-03-15")).toBe(3);
    expect(elapsedPeriods("WEEKLY", "2026-03-04", "2026-03-04")).toBe(1);
    expect(elapsedPeriods("WEEKLY", "2026-03-04", "2026-03-18")).toBe(3);
  });

  it("cruza el cambio de año", () => {
    expect(elapsedPeriods("MONTHLY", "2025-11-01", "2026-02-15")).toBe(4);
  });

  it("da cero si todavía no empezó", () => {
    expect(elapsedPeriods("MONTHLY", "2026-06-01", "2026-03-15")).toBe(0);
  });

  it("un período fijo es siempre uno", () => {
    expect(elapsedPeriods("CUSTOM", "2026-01-01", "2026-12-31")).toBe(1);
  });
});

describe("renovación y fin", () => {
  it("dice cuándo se renueva", () => {
    expect(
      nextPeriodStart("MONTHLY", { start: "2026-03-01", end: "2026-03-31" }),
    ).toBe("2026-04-01");
    expect(
      nextPeriodStart("WEEKLY", { start: "2026-03-04", end: "2026-03-10" }),
    ).toBe("2026-03-11");
  });

  it("un período fijo no se renueva", () => {
    expect(
      nextPeriodStart("CUSTOM", { start: "2026-01-01", end: "2026-12-31" }),
    ).toBeNull();
  });

  it("detecta si ya terminó", () => {
    expect(hasEnded("2026-03-31", "2026-04-01")).toBe(true);
    expect(hasEnded("2026-03-31", "2026-03-31")).toBe(false);
    expect(hasEnded(null, "2099-01-01")).toBe(false);
  });
});

describe("estado sin rollover", () => {
  const base = {
    amountMinor: 50_000n, // 500,00
    rollover: false,
    elapsedPeriods: 3,
  };

  it("cada período arranca limpio, sin importar los anteriores", () => {
    const status = budgetStatus({
      ...base,
      periodSpentMinor: 20_000n,
      // Se gastó muchísimo antes: da igual, no hay arrastre.
      totalSpentMinor: 900_000n,
    });

    expect(status.effectiveAmountMinor).toBe(50_000n);
    expect(status.remainingMinor).toBe(30_000n);
    expect(status.carriedMinor).toBe(0n);
    expect(status.state).toBe("OK");
  });

  it("avisa a partir del 80%", () => {
    expect(
      budgetStatus({
        ...base,
        periodSpentMinor: 39_500n,
        totalSpentMinor: 39_500n,
      }).state,
    ).toBe("OK");
    expect(
      budgetStatus({
        ...base,
        periodSpentMinor: 40_000n,
        totalSpentMinor: 40_000n,
      }).state,
    ).toBe("WARNING");
    expect(WARNING_THRESHOLD).toBe(80);
  });

  it("marca el sobregiro y lo reporta en negativo", () => {
    const status = budgetStatus({
      ...base,
      periodSpentMinor: 62_500n,
      totalSpentMinor: 62_500n,
    });

    expect(status.state).toBe("OVER");
    expect(status.remainingMinor).toBe(-12_500n);
    expect(status.rawPercentage).toBe(125);
    // La barra no se pasa del 100 aunque el porcentaje real sí.
    expect(status.percentage).toBe(100);
  });
});

describe("estado con rollover", () => {
  const base = { amountMinor: 50_000n, rollover: true };

  it("lo que sobró del período anterior suma al actual", () => {
    // 3 períodos × 500 = 1500 presupuestado. Antes se gastaron 700, así que
    // sobran 800 para este mes en vez de 500.
    const status = budgetStatus({
      ...base,
      elapsedPeriods: 3,
      periodSpentMinor: 10_000n,
      totalSpentMinor: 80_000n,
    });

    expect(status.effectiveAmountMinor).toBe(80_000n);
    expect(status.carriedMinor).toBe(30_000n);
    expect(status.remainingMinor).toBe(70_000n);
    expect(status.state).toBe("OK");
  });

  it("pasarse un mes se come el siguiente", () => {
    // Es lo que significa un sobre. 2 períodos × 500 = 1000; antes se
    // gastaron 900, así que este mes arranca con 100 y no con 500.
    const status = budgetStatus({
      ...base,
      elapsedPeriods: 2,
      periodSpentMinor: 0n,
      totalSpentMinor: 90_000n,
    });

    expect(status.effectiveAmountMinor).toBe(10_000n);
    expect(status.carriedMinor).toBe(-40_000n);
  });

  it("un tope efectivo agotado se muestra al 100%, no a un número raro", () => {
    // Se gastó todo el acumulado en períodos anteriores: no queda nada,
    // sin importar cuál sería el porcentaje exacto.
    const status = budgetStatus({
      ...base,
      elapsedPeriods: 2,
      periodSpentMinor: 5_000n,
      totalSpentMinor: 105_000n,
    });

    expect(status.effectiveAmountMinor).toBeLessThanOrEqual(0n);
    expect(status.percentage).toBe(100);
    expect(status.state).toBe("OVER");
  });

  it("en el primer período se comporta igual que sin rollover", () => {
    const conRollover = budgetStatus({
      ...base,
      elapsedPeriods: 1,
      periodSpentMinor: 20_000n,
      totalSpentMinor: 20_000n,
    });
    const sinRollover = budgetStatus({
      amountMinor: 50_000n,
      rollover: false,
      elapsedPeriods: 1,
      periodSpentMinor: 20_000n,
      totalSpentMinor: 20_000n,
    });

    expect(conRollover.effectiveAmountMinor).toBe(
      sinRollover.effectiveAmountMinor,
    );
    expect(conRollover.carriedMinor).toBe(0n);
  });

  it("no pierde precisión con importes grandes", () => {
    // Presupuesto de 90 mil millones de pesos: muy por encima de 2^53.
    const status = budgetStatus({
      amountMinor: 9_000_000_000_000n,
      rollover: true,
      elapsedPeriods: 12,
      periodSpentMinor: 1n,
      totalSpentMinor: 1n,
    });

    expect(status.effectiveAmountMinor).toBe(108_000_000_000_000n);
    expect(status.remainingMinor).toBe(107_999_999_999_999n);
  });
});

describe("bordes", () => {
  it("un presupuesto sin gasto está al 0%", () => {
    const status = budgetStatus({
      amountMinor: 50_000n,
      rollover: false,
      elapsedPeriods: 1,
      periodSpentMinor: 0n,
      totalSpentMinor: 0n,
    });

    expect(status.percentage).toBe(0);
    expect(status.state).toBe("OK");
    expect(status.remainingMinor).toBe(50_000n);
  });

  it("gastar exactamente el tope no es sobregiro", () => {
    const status = budgetStatus({
      amountMinor: 50_000n,
      rollover: false,
      elapsedPeriods: 1,
      periodSpentMinor: 50_000n,
      totalSpentMinor: 50_000n,
    });

    expect(status.remainingMinor).toBe(0n);
    expect(status.state).toBe("WARNING");
    expect(status.percentage).toBe(100);
  });
});
