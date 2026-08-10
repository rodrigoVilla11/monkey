import { describe, expect, it } from "vitest";

import type { RecurringRuleDTO } from "@/shared/contracts/recurring";
import { scheduledTotals } from "@/shared/recurring-totals";

/**
 * Totales de lo programado.
 *
 * Lo que este archivo defiende es que el total NO es la suma de los importes de
 * las reglas: un seguro anual y un alquiler mensual no pesan lo mismo en tres
 * meses, y sumarlos de plano daría un número que nadie puede usar para decidir
 * nada.
 */

const rule = (over: Partial<RecurringRuleDTO>): RecurringRuleDTO => ({
  id: "r1",
  type: "EXPENSE",
  amount: { amountMinor: "10000", currency: "EUR" },
  description: null,
  payee: null,
  account: { id: "a1", name: "Cuenta", color: null, icon: null },
  category: null,
  frequency: "MONTHLY",
  interval: 1,
  byMonthDay: 10,
  byWeekday: null,
  byMonth: null,
  summary: "",
  startDate: "2026-01-10",
  endDate: null,
  maxOccurrences: null,
  nextRunDate: "2026-03-10",
  lastRunAt: null,
  occurrencesCreated: 2,
  autoPost: true,
  isActive: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  ...over,
});

/** Hoy es el 1 de marzo y la ventana elegida llega a fin de mayo. */
const UNTIL = "2026-05-31";

describe("totales programados", () => {
  it("cuenta una ocurrencia por vez que la regla cae en el rango", () => {
    // Mensual el 10: marzo, abril y mayo.
    const [total] = scheduledTotals([rule({})], UNTIL, "EUR");

    expect(total?.expense.amountMinor).toBe("30000");
    expect(total?.income.amountMinor).toBe("0");
  });

  it("una anual fuera del rango no suma nada", () => {
    const totals = scheduledTotals(
      [
        rule({
          frequency: "YEARLY",
          byMonth: 9,
          startDate: "2026-09-10",
          nextRunDate: "2026-09-10",
        }),
      ],
      UNTIL,
      "EUR",
    );

    expect(totals).toEqual([]);
  });

  it("no pesa igual lo anual que lo mensual", () => {
    const [total] = scheduledTotals(
      [
        rule({ id: "alquiler", amount: dinero("95000") }),
        rule({
          id: "seguro",
          amount: dinero("60000"),
          frequency: "YEARLY",
          byMonth: 3,
          startDate: "2026-03-10",
          nextRunDate: "2026-03-10",
        }),
      ],
      UNTIL,
      "EUR",
    );

    // Tres alquileres y un seguro, no 95000 + 60000.
    expect(total?.expense.amountMinor).toBe("345000");
  });

  it("separa ingresos de egresos y calcula el neto", () => {
    const [total] = scheduledTotals(
      [
        rule({ id: "sueldo", type: "INCOME", amount: dinero("300000") }),
        rule({ id: "alquiler", amount: dinero("95000") }),
      ],
      UNTIL,
      "EUR",
    );

    expect(total?.income.amountMinor).toBe("900000");
    expect(total?.expense.amountMinor).toBe("285000");
    expect(total?.net.amountMinor).toBe("615000");
  });

  it("una regla pausada no promete nada", () => {
    const totals = scheduledTotals(
      [rule({ isActive: false, nextRunDate: null })],
      UNTIL,
      "EUR",
    );

    expect(totals).toEqual([]);
  });

  it("maxOccurrences corta la cuenta", () => {
    // Doce cuotas desde enero: en el rango solo quedan marzo y abril.
    const [total] = scheduledTotals(
      [rule({ startDate: "2026-01-10", maxOccurrences: 4 })],
      UNTIL,
      "EUR",
    );

    expect(total?.expense.amountMinor).toBe("20000");
  });

  it("lo vencido cuenta: el job atrasado no borra la deuda", () => {
    // El job no corre desde enero y `nextRunDate` quedó atrás del rango.
    const [total] = scheduledTotals(
      [rule({ nextRunDate: "2026-01-10" })],
      UNTIL,
      "EUR",
    );

    // Enero y febrero vencidos, más marzo, abril y mayo.
    expect(total?.expense.amountMinor).toBe("50000");
  });

  it("no suma monedas distintas y pone la principal primero", () => {
    const totals = scheduledTotals(
      [
        rule({ id: "eur", amount: dinero("10000", "EUR") }),
        rule({ id: "ars", amount: dinero("500000", "ARS") }),
      ],
      UNTIL,
      "ARS",
    );

    expect(totals.map((t) => t.currency)).toEqual(["ARS", "EUR"]);
    expect(totals[0]?.expense.amountMinor).toBe("1500000");
    expect(totals[1]?.expense.amountMinor).toBe("30000");
  });
});

function dinero(amountMinor: string, currency = "EUR") {
  return { amountMinor, currency };
}
