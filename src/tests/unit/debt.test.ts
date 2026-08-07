import { describe, expect, it } from "vitest";

import {
  debtBalance,
  debtForecast,
  installmentProgress,
  monthlyInterestCost,
  netPosition,
} from "@/shared/debt";

/**
 * Deudas.
 *
 * Lo que se cuida acá: que el saldo sea `original − pagos` y nada más —sin
 * capitalizar intereses por nuestra cuenta—, que el interés que se muestra sea
 * el costo del saldo y no una cuota, y que el patrimonio neto diga
 * explícitamente qué suma y qué resta.
 */

describe("saldo", () => {
  it("es original menos pagos", () => {
    const result = debtBalance(1_000_000n, 250_000n);

    expect(result.paidMinor).toBe(250_000n);
    expect(result.remainingMinor).toBe(750_000n);
    expect(result.percentage).toBe(25);
    expect(result.settled).toBe(false);
  });

  it("no capitaliza intereses en el saldo", () => {
    // Aunque la deuda tenga tasa, el saldo sigue siendo lo pactado menos lo
    // pagado. Capitalizar sería inventar el calendario del acreedor.
    const result = debtBalance(1_000_000n, 0n);
    expect(result.remainingMinor).toBe(1_000_000n);
  });

  it("marca saldada y guarda lo pagado de más", () => {
    const result = debtBalance(1_000_000n, 1_050_000n);

    expect(result.settled).toBe(true);
    expect(result.remainingMinor).toBe(0n);
    expect(result.overpaidMinor).toBe(50_000n);
    expect(result.percentage).toBe(100);
  });

  it("pagar justo lo pactado la salda", () => {
    const result = debtBalance(1_000_000n, 1_000_000n);
    expect(result.settled).toBe(true);
    expect(result.overpaidMinor).toBe(0n);
  });

  it("redondea el porcentaje al más cercano", () => {
    // 86,07 % → 86,1.
    expect(debtBalance(115_010n, 98_990n).percentage).toBe(86.1);
  });

  it("no divide por cero", () => {
    expect(debtBalance(0n, 100n).percentage).toBe(0);
  });
});

describe("costo del interés", () => {
  it("dice cuánto genera por mes el saldo pendiente", () => {
    // 5.000,00 € al 12 % anual → 50,00 € por mes.
    expect(monthlyInterestCost(500_000n, 1200)).toBe(5000n);
  });

  it("usa interés simple mensual, no compuesto", () => {
    // 1.000,00 € al 24 % anual → 20,00 €/mes (24/12 = 2 %), no 1,81 de una
    // capitalización mensual. Componer exige saber cada cuánto capitaliza el
    // acreedor, que es justo lo que no sabemos.
    expect(monthlyInterestCost(100_000n, 2400)).toBe(2000n);
  });

  it("no dice nada sin tasa o sin saldo", () => {
    expect(monthlyInterestCost(500_000n, null)).toBeNull();
    expect(monthlyInterestCost(500_000n, 0)).toBeNull();
    expect(monthlyInterestCost(0n, 1200)).toBeNull();
  });
});

describe("proyección", () => {
  const base = {
    remainingMinor: 750_000n,
    paidMinor: 250_000n,
    firstPaymentDate: "2026-02-07" as const,
    today: "2026-08-07" as const,
  };

  it("dice cuánto hay que pagar por mes para llegar al vencimiento", () => {
    const result = debtForecast({ ...base, dueDate: "2027-02-07" });

    // Faltan 7.500,00 € y ~6 meses.
    expect(result.requiredPerMonthMinor).toBe(125_000n);
  });

  it("compara el ritmo real contra el necesario", () => {
    // 2.500,00 € en 181 días = 5,947 meses → 420,44 €/mes, contra los 1.250,00
    // que harían falta.
    const result = debtForecast({ ...base, dueDate: "2027-02-07" });

    expect(result.actualPerMonthMinor).toBe(42_044n);
    expect(result.status).toBe("BEHIND");
  });

  it("va en tiempo si el ritmo alcanza", () => {
    const result = debtForecast({
      remainingMinor: 50_000n,
      paidMinor: 950_000n,
      dueDate: "2027-08-07",
      firstPaymentDate: "2026-02-07",
      today: "2026-08-07",
    });

    expect(result.status).toBe("ON_TRACK");
  });

  it("una deuda saldada no está vencida aunque pasara la fecha", () => {
    const result = debtForecast({
      remainingMinor: 0n,
      paidMinor: 1_000_000n,
      dueDate: "2026-01-01",
      firstPaymentDate: "2025-06-01",
      today: "2026-08-07",
    });

    expect(result.status).toBe("SETTLED");
    expect(result.requiredPerMonthMinor).toBeNull();
  });

  it("marca vencida la que pasó la fecha con saldo", () => {
    const result = debtForecast({ ...base, dueDate: "2026-07-01" });

    expect(result.status).toBe("OVERDUE");
    expect(result.daysRemaining).toBeLessThan(0);
  });

  it("sin vencimiento no hay atraso posible", () => {
    const result = debtForecast({ ...base, dueDate: null });

    expect(result.status).toBe("ON_TRACK");
    expect(result.daysRemaining).toBeNull();
    expect(result.requiredPerMonthMinor).toBeNull();
  });

  it("con menos de una semana de historia no se inventa un ritmo", () => {
    const result = debtForecast({
      remainingMinor: 750_000n,
      paidMinor: 10_000n,
      dueDate: "2026-09-07",
      firstPaymentDate: "2026-08-05",
      today: "2026-08-07",
    });

    expect(result.actualPerMonthMinor).toBeNull();
    expect(result.status).toBe("ON_TRACK");
  });

  it("proyecta cuándo quedaría saldada al ritmo actual", () => {
    const result = debtForecast({ ...base, dueDate: null });

    expect(result.projectedDate).not.toBeNull();
    // 7.500,00 € a 420,52 €/mes se va bastante más allá del año.
    expect(result.projectedDate! > "2027-08-07").toBe(true);
  });

  it("el día del vencimiento no divide por cero", () => {
    const result = debtForecast({ ...base, dueDate: "2026-08-07" });

    expect(result.daysRemaining).toBe(0);
    expect(result.requiredPerMonthMinor).toBe(750_000n);
  });
});

describe("cuotas", () => {
  it("cuenta los pagos registrados, no divide el importe", () => {
    // Pagar de más un mes no adelanta una cuota: la cuota es un hecho del
    // acuerdo, no una división del saldo.
    expect(installmentProgress(3, 12)).toEqual({ paid: 3, total: 12 });
  });

  it("no se pasa del total pactado", () => {
    expect(installmentProgress(15, 12)).toEqual({ paid: 12, total: 12 });
  });

  it("sin cuotas pactadas no dice nada", () => {
    expect(installmentProgress(3, null)).toBeNull();
    expect(installmentProgress(3, 0)).toBeNull();
  });
});

describe("patrimonio neto", () => {
  it("suma lo que te deben y resta lo que debés", () => {
    const result = netPosition(1_000_000n, 200_000n, 350_000n);

    expect(result.netMinor).toBe(850_000n);
    expect(result.accountsMinor).toBe(1_000_000n);
    expect(result.receivableMinor).toBe(200_000n);
    expect(result.payableMinor).toBe(350_000n);
  });

  it("un préstamo recién recibido sube el saldo pero no el patrimonio", () => {
    // Los 10.000 están en la cuenta Y se deben: las dos cifras son ciertas y
    // responden preguntas distintas. Por eso la curva de los reportes sigue
    // siendo "saldo de cuentas" y esto vive aparte.
    const antes = netPosition(0n, 0n, 0n);
    const despues = netPosition(1_000_000n, 0n, 1_000_000n);

    expect(despues.accountsMinor).toBe(1_000_000n);
    expect(despues.netMinor).toBe(antes.netMinor);
  });

  it("puede ser negativo", () => {
    expect(netPosition(10_000n, 0n, 500_000n).netMinor).toBe(-490_000n);
  });
});
