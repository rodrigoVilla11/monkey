import { describe, expect, it } from "vitest";

import {
  debtBalance,
  debtForecast,
  debtPlanProgress,
  installmentProgress,
  monthlyInterestCost,
  netPosition,
  type DebtPlan,
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

describe("plan de pago/cobro", () => {
  /** 300,00 por mes desde el 5 de marzo. */
  const mensual: DebtPlan = {
    amountMinor: 30_000n,
    frequency: "MONTHLY",
    interval: 1,
    startDate: "2026-03-05",
    installmentsTotal: null,
  };

  it("cuenta las fechas que ya pasaron, hoy incluido", () => {
    const result = debtPlanProgress({
      plan: mensual,
      originalMinor: 360_000n,
      paidMinor: 0n,
      today: "2026-06-05",
    });

    // 5 de marzo, abril, mayo y junio: el de hoy ya venció.
    expect(result.dueCount).toBe(4);
    expect(result.expectedToDateMinor).toBe(120_000n);
    expect(result.nextDate).toBe("2026-07-05");
  });

  it("un día antes de la fecha todavía no la cuenta", () => {
    const result = debtPlanProgress({
      plan: mensual,
      originalMinor: 360_000n,
      paidMinor: 0n,
      today: "2026-06-04",
    });

    expect(result.dueCount).toBe(3);
    expect(result.nextDate).toBe("2026-06-05");
  });

  it("el atraso es contra lo vencido, no contra el total", () => {
    // Debe 3.600 y pagó 600 de los 1.200 que ya vencieron: atrasada en 600,
    // no en 3.000. Lo que todavía no venció no es un atraso.
    const result = debtPlanProgress({
      plan: mensual,
      originalMinor: 360_000n,
      paidMinor: 60_000n,
      today: "2026-06-05",
    });

    expect(result.behindMinor).toBe(60_000n);
  });

  it("al día es cero, y pagar de más tampoco es negativo", () => {
    const alDia = debtPlanProgress({
      plan: mensual,
      originalMinor: 360_000n,
      paidMinor: 120_000n,
      today: "2026-06-05",
    });
    expect(alDia.behindMinor).toBe(0n);

    const adelantado = debtPlanProgress({
      plan: mensual,
      originalMinor: 360_000n,
      paidMinor: 300_000n,
      today: "2026-06-05",
    });
    expect(adelantado.behindMinor).toBe(0n);
  });

  it("lo esperado nunca pasa del total de la deuda", () => {
    // Doce fechas de 300 contra una deuda de 1.000: cuando ya vencieron todas,
    // lo esperado son 1.000, no 3.600.
    const result = debtPlanProgress({
      plan: mensual,
      originalMinor: 100_000n,
      paidMinor: 0n,
      today: "2030-01-01",
    });

    expect(result.expectedToDateMinor).toBe(100_000n);
    expect(result.behindMinor).toBe(100_000n);
  });

  it("la última cuota es la que queda corta", () => {
    // 1.000 en cuotas de 300 son CUATRO fechas: 300, 300, 300 y 100.
    const result = debtPlanProgress({
      plan: mensual,
      originalMinor: 100_000n,
      paidMinor: 0n,
      today: "2026-03-05",
    });

    expect(result.payoffDate).toBe("2026-06-05");
    expect(result.coversDebt).toBe(true);
  });

  it("avisa cuando las cuotas pactadas no cubren la deuda", () => {
    // Tres de 300 contra 3.600: el acuerdo no cierra, y enterarse en la última
    // cuota es tarde.
    const result = debtPlanProgress({
      plan: { ...mensual, installmentsTotal: 3 },
      originalMinor: 360_000n,
      paidMinor: 0n,
      today: "2026-03-05",
    });

    expect(result.coversDebt).toBe(false);
    expect(result.payoffDate).toBeNull();
  });

  it("no se pasa del tope de cuotas pactadas", () => {
    const result = debtPlanProgress({
      plan: { ...mensual, installmentsTotal: 3 },
      originalMinor: 360_000n,
      paidMinor: 0n,
      today: "2027-01-01",
    });

    expect(result.dueCount).toBe(3);
    expect(result.nextDate).toBeNull();
  });

  it("dice cuántas cuotas faltan, contando la última corta", () => {
    // 3.600 en cuotas de 300: doce. Con 3.000 pagados quedan dos.
    const nuevas = debtPlanProgress({
      plan: mensual,
      originalMinor: 360_000n,
      paidMinor: 0n,
      today: "2026-03-05",
    });
    expect(nuevas.remainingInstallments).toBe(12);

    const casi = debtPlanProgress({
      plan: mensual,
      originalMinor: 360_000n,
      paidMinor: 300_000n,
      today: "2026-03-05",
    });
    expect(casi.remainingInstallments).toBe(2);

    // 1.000 en cuotas de 300 son cuatro: 300, 300, 300 y 100.
    const corta = debtPlanProgress({
      plan: mensual,
      originalMinor: 100_000n,
      paidMinor: 0n,
      today: "2026-03-05",
    });
    expect(corta.remainingInstallments).toBe(4);
  });

  it("las cuotas que faltan salen del saldo, no de contar pagos", () => {
    // Un solo pago de 900 adelanta TRES cuotas de 300. Contar pagos diría que
    // falta una menos; lo que manda es lo que se debe.
    const result = debtPlanProgress({
      plan: mensual,
      originalMinor: 360_000n,
      paidMinor: 90_000n,
      today: "2026-03-05",
    });

    expect(result.remainingInstallments).toBe(9);
  });

  it("una deuda saldada no tiene próxima fecha", () => {
    const result = debtPlanProgress({
      plan: mensual,
      originalMinor: 360_000n,
      paidMinor: 360_000n,
      today: "2026-06-05",
    });

    expect(result.nextDate).toBeNull();
    expect(result.behindMinor).toBe(0n);
    expect(result.remainingInstallments).toBe(0);
  });

  it("quincenal es semanal cada dos, y no deriva", () => {
    const result = debtPlanProgress({
      plan: {
        amountMinor: 10_000n,
        frequency: "WEEKLY",
        interval: 2,
        startDate: "2026-03-05",
        installmentsTotal: null,
      },
      originalMinor: 100_000n,
      paidMinor: 0n,
      today: "2026-04-02",
    });

    // 5, 19 de marzo y 2 de abril.
    expect(result.dueCount).toBe(3);
    expect(result.nextDate).toBe("2026-04-16");
  });

  it("un plan mensual arrancado un 31 vuelve al 31 después de febrero", () => {
    // La regla del motor de recurrencia, que es justo la que evita que el plan
    // se mude solo al 28 para siempre.
    const result = debtPlanProgress({
      plan: {
        amountMinor: 10_000n,
        frequency: "MONTHLY",
        interval: 1,
        startDate: "2026-01-31",
        installmentsTotal: null,
      },
      originalMinor: 100_000n,
      paidMinor: 0n,
      today: "2026-02-28",
    });

    expect(result.dueCount).toBe(2);
    expect(result.nextDate).toBe("2026-03-31");
  });

  it("un plan de un centavo contra una deuda enorme no cuelga ni miente", () => {
    // Sin el horizonte, esto pediría cinco millones de iteraciones. Con él, la
    // respuesta honesta es que el plan no cubre la deuda.
    const result = debtPlanProgress({
      plan: {
        amountMinor: 1n,
        frequency: "DAILY",
        interval: 1,
        startDate: "2026-01-01",
        installmentsTotal: null,
      },
      originalMinor: 5_000_000n,
      paidMinor: 0n,
      today: "2030-01-01",
    });

    expect(result.coversDebt).toBe(false);
    expect(result.payoffDate).toBeNull();
    expect(result.dueCount).toBe(600);
  });

  it("sin vencimiento, el plan es lo que permite decir que está atrasada", () => {
    const plan = debtPlanProgress({
      plan: mensual,
      originalMinor: 360_000n,
      paidMinor: 0n,
      today: "2026-06-05",
    });

    const conPlan = debtForecast({
      remainingMinor: 360_000n,
      paidMinor: 0n,
      dueDate: null,
      firstPaymentDate: null,
      today: "2026-06-05",
      plan,
    });
    expect(conPlan.status).toBe("BEHIND");

    // La misma deuda sin plan no puede estar atrasada: no hay contra qué.
    const sinPlan = debtForecast({
      remainingMinor: 360_000n,
      paidMinor: 0n,
      dueDate: null,
      firstPaymentDate: null,
      today: "2026-06-05",
    });
    expect(sinPlan.status).toBe("ON_TRACK");
  });

  it("el plan al día no pisa el vencimiento ya pasado", () => {
    // Cumplir el plan no arregla una deuda vencida: OVERDUE sigue mandando.
    const plan = debtPlanProgress({
      plan: mensual,
      originalMinor: 360_000n,
      paidMinor: 120_000n,
      today: "2026-06-05",
    });

    const result = debtForecast({
      remainingMinor: 240_000n,
      paidMinor: 120_000n,
      dueDate: "2026-05-01",
      firstPaymentDate: "2026-03-05",
      today: "2026-06-05",
      plan,
    });

    expect(result.status).toBe("OVERDUE");
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
