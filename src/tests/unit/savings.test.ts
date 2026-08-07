import { describe, expect, it } from "vitest";

import { goalForecast, goalProgress } from "@/shared/savings";

/**
 * Metas de ahorro: progreso y proyección.
 *
 * Lo que se cuida acá es que la barra nunca mienta: ni se pase del 100 %, ni
 * muestre un porcentaje negativo cuando se retiró más de lo aportado, ni diga
 * que una meta va bien porque todavía no hay datos suficientes para saberlo.
 */

describe("progreso", () => {
  it("calcula lo ahorrado, lo que falta y el porcentaje", () => {
    const result = goalProgress(30_000n, 100_000n);

    expect(result.savedMinor).toBe(30_000n);
    expect(result.remainingMinor).toBe(70_000n);
    expect(result.percentage).toBe(30);
    expect(result.achieved).toBe(false);
    expect(result.surplusMinor).toBe(0n);
  });

  it("redondea el porcentaje al más cercano, no hacia abajo", () => {
    // 86,07 % tiene que verse 86,1.
    expect(goalProgress(98_990n, 115_010n).percentage).toBe(86.1);
  });

  it("marca la meta alcanzada y no pasa del 100 %", () => {
    const result = goalProgress(120_000n, 100_000n);

    expect(result.achieved).toBe(true);
    expect(result.percentage).toBe(100);
    expect(result.remainingMinor).toBe(0n);
    // El excedente no se pierde: se muestra aparte.
    expect(result.surplusMinor).toBe(20_000n);
  });

  it("justo en el objetivo cuenta como alcanzada", () => {
    const result = goalProgress(100_000n, 100_000n);
    expect(result.achieved).toBe(true);
    expect(result.percentage).toBe(100);
    expect(result.surplusMinor).toBe(0n);
  });

  it("un saldo negativo es 0 %, no un porcentaje negativo", () => {
    // Se retiró más de lo que se había aportado.
    const result = goalProgress(-5000n, 100_000n);

    expect(result.percentage).toBe(0);
    expect(result.achieved).toBe(false);
    expect(result.remainingMinor).toBe(105_000n);
  });

  it("un objetivo en cero no divide por cero", () => {
    expect(goalProgress(1000n, 0n).percentage).toBe(0);
  });
});

describe("proyección", () => {
  const base = {
    savedMinor: 30_000n,
    targetMinor: 120_000n,
    today: "2026-08-07" as const,
    firstContributionDate: "2026-02-07" as const,
  };

  it("dice cuánto hay que apartar por mes para llegar a tiempo", () => {
    // Faltan 900,00 € y quedan ~6 meses.
    const result = goalForecast({ ...base, targetDate: "2026-02-07" });
    expect(result.pace).toBe("OVERDUE");

    const onTime = goalForecast({ ...base, targetDate: "2027-02-07" });
    // 184 días ≈ 6 meses → 900,00 / 6 = 150,00 € por mes.
    expect(onTime.requiredPerMonthMinor).toBe(15_000n);
  });

  it("compara el ritmo real contra el necesario", () => {
    // 300,00 € en 181 días = 5,947 meses → 50,45 €/mes, contra los 150,00 que
    // harían falta. Se divide por 30,44 y no por 30: el mes medio no tiene 30.
    const behind = goalForecast({ ...base, targetDate: "2027-02-07" });

    expect(behind.actualPerMonthMinor).toBe(5045n);
    expect(behind.pace).toBe("BEHIND");
  });

  it("va en tiempo si el ritmo alcanza", () => {
    const result = goalForecast({
      savedMinor: 90_000n,
      targetMinor: 120_000n,
      targetDate: "2027-08-07",
      firstContributionDate: "2026-02-07",
      today: "2026-08-07",
    });

    expect(result.pace).toBe("ON_TRACK");
  });

  it("proyecta la fecha de llegada al ritmo actual", () => {
    const result = goalForecast({ ...base, targetDate: "2027-02-07" });

    // Faltan 900,00 € a 50,00 €/mes = 18 meses.
    expect(result.projectedDate).not.toBeNull();
    expect(result.projectedDate! > "2027-02-07").toBe(true);
  });

  it("no proyecta a más de diez años: el número no informaría nada", () => {
    const result = goalForecast({
      savedMinor: 100n,
      targetMinor: 100_000_000n,
      targetDate: null,
      firstContributionDate: "2026-02-07",
      today: "2026-08-07",
    });

    expect(result.projectedDate).toBeNull();
  });

  it("una meta alcanzada no está atrasada aunque venciera el plazo", () => {
    const result = goalForecast({
      savedMinor: 120_000n,
      targetMinor: 120_000n,
      targetDate: "2026-01-01",
      firstContributionDate: "2025-06-01",
      today: "2026-08-07",
    });

    expect(result.pace).toBe("ACHIEVED");
    expect(result.requiredPerMonthMinor).toBeNull();
  });

  it("sin fecha objetivo no hay atraso posible", () => {
    const result = goalForecast({ ...base, targetDate: null });

    expect(result.pace).toBe("ON_TRACK");
    expect(result.requiredPerMonthMinor).toBeNull();
    expect(result.daysRemaining).toBeNull();
  });

  it("con menos de una semana de historia no se inventa un ritmo", () => {
    // Una meta creada anteayer no puede ir "atrasada": no hay con qué medirlo.
    const result = goalForecast({
      savedMinor: 1000n,
      targetMinor: 120_000n,
      targetDate: "2026-09-07",
      firstContributionDate: "2026-08-05",
      today: "2026-08-07",
    });

    expect(result.actualPerMonthMinor).toBeNull();
    expect(result.pace).toBe("ON_TRACK");
  });

  it("sin aportes tampoco hay ritmo", () => {
    const result = goalForecast({
      savedMinor: 0n,
      targetMinor: 120_000n,
      targetDate: "2027-08-07",
      firstContributionDate: null,
      today: "2026-08-07",
    });

    expect(result.actualPerMonthMinor).toBeNull();
    expect(result.projectedDate).toBeNull();
  });

  it("el día del vencimiento no divide por cero", () => {
    const result = goalForecast({
      savedMinor: 30_000n,
      targetMinor: 120_000n,
      targetDate: "2026-08-07",
      firstContributionDate: "2026-02-07",
      today: "2026-08-07",
    });

    expect(result.daysRemaining).toBe(0);
    // Lo que falta hace falta ya: no se reparte en cero meses.
    expect(result.requiredPerMonthMinor).toBe(90_000n);
  });
});
