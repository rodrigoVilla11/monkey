import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { forSpace } from "@/server/db/scoped";
import { systemClient } from "@/server/db/system";
import { accountBalances } from "@/server/services/balances";
import {
  addPayment,
  createDebt,
  deleteDebt,
  getDebt,
  listDebts,
  netPositionOf,
  removePayment,
  updateDebt,
} from "@/server/services/debts";
import { createRate } from "@/server/services/rates/manage";
import { monthlyReport } from "@/server/services/reports";
import { todayIn } from "@/shared/dates";

import { disconnect, resetDatabase, testDb } from "./helpers/db";

/**
 * Deudas contra Postgres real.
 *
 * Lo que más importa acá:
 *
 *  · El saldo es `original − pagos` y NO capitaliza intereses. monKey registra,
 *    no amortiza.
 *  · Registrar un pago no crea un movimiento ni toca los saldos: si lo hiciera,
 *    cargarlo desde acá y desde la pantalla de movimientos lo contaría dos veces.
 *  · La posición neta vive aparte de la curva de patrimonio de los reportes, y
 *    un préstamo recién recibido lo demuestra: sube la caja y no sube el neto.
 */

const TIMEZONE = "Europe/Madrid";

interface Space {
  readonly spaceId: string;
  readonly accountId: string;
  readonly primaryCurrency: string;
}

let counter = 0;

const makeSpace = async (primaryCurrency = "EUR"): Promise<Space> => {
  counter += 1;
  const label = counter.toString().padStart(3, "0");

  const user = await testDb.user.create({
    data: {
      email: `debts-${label}@monkey.test`,
      passwordHash: "hash",
      name: "Rodrigo",
      timezone: TIMEZONE,
      locale: "es-ES",
      emailVerifiedAt: new Date(),
    },
  });

  const space = await testDb.space.create({
    data: {
      name: `Space ${label}`,
      primaryCurrency,
      timezone: TIMEZONE,
      memberships: { create: { userId: user.id, role: "OWNER" } },
    },
  });

  const account = await forSpace(space.id).account.create({
    data: {
      spaceId: space.id,
      name: "Corriente",
      type: "BANK",
      currency: primaryCurrency,
      initialBalanceMinor: 1_000_000n,
    },
  });

  return { spaceId: space.id, accountId: account.id, primaryCurrency };
};

const context = (space: Space) => ({
  spaceId: space.spaceId,
  primaryCurrency: space.primaryCurrency,
});

/**
 * Fecha fija y pasada para las cotizaciones: el proveedor busca la última con
 * fecha menor o igual a hoy, así que una del pasado sirve corra el día que
 * corra. Una de mañana no se encontraría nunca.
 */
const RATE_DATE = "2026-01-02";

const addRate = (base: string, quote: string, rate: string) =>
  systemClient().$transaction(async (tx) =>
    createRate(tx, TIMEZONE, {
      baseCurrency: base,
      quoteCurrency: quote,
      rate,
      date: RATE_DATE,
    }),
  );

const ACTOR = { userId: null, name: "Rodrigo" };

const addDebt = (
  space: Space,
  over: Record<string, unknown> = {},
): Promise<string> =>
  systemClient().$transaction(async (tx) =>
    createDebt(forSpace(space.spaceId), tx, context(space), ACTOR, {
      direction: "OWED_BY_ME",
      counterparty: "Mi hermano",
      originalAmountMinor: "500000",
      startDate: "2026-02-01",
      ...over,
    }),
  );

const pay = (
  space: Space,
  debtId: string,
  input: Record<string, unknown>,
): Promise<string> =>
  systemClient().$transaction(async (tx) =>
    addPayment(
      forSpace(space.spaceId),
      tx,
      context(space),
      debtId,
      TIMEZONE,
      input,
    ),
  );

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await disconnect();
});

describe("registra, no amortiza", () => {
  it("el saldo es original menos pagos, sin capitalizar interés", async () => {
    const space = await makeSpace();
    // 12 % anual: la tasa NO entra en el saldo.
    const debtId = await addDebt(space, { interestRateBps: 1200 });

    await pay(space, debtId, { amountMinor: "125000", date: "2026-03-01" });

    const debt = await getDebt(forSpace(space.spaceId), TIMEZONE, debtId);

    expect(debt.paid.amountMinor).toBe("125000");
    expect(debt.remaining.amountMinor).toBe("375000");
    expect(debt.percentage).toBe(25);
  });

  it("muestra el interés como costo del saldo, no como cuota", async () => {
    const space = await makeSpace();
    const debtId = await addDebt(space, { interestRateBps: 1200 });

    const debt = await getDebt(forSpace(space.spaceId), TIMEZONE, debtId);

    // 5.000,00 € al 12 % anual → 50,00 €/mes de interés.
    expect(debt.monthlyInterestCost?.amountMinor).toBe("5000");
    // Y no se confunde con lo que habría que pagar para llegar al vencimiento.
    expect(debt.requiredPerMonth).toBeNull();
  });

  it("sin tasa no inventa ningún interés", async () => {
    const space = await makeSpace();
    const debtId = await addDebt(space);

    const debt = await getDebt(forSpace(space.spaceId), TIMEZONE, debtId);

    expect(debt.interestRateBps).toBeNull();
    expect(debt.monthlyInterestCost).toBeNull();
  });
});

describe("plan de pago/cobro", () => {
  /**
   * Las fechas están elegidas para que el test no dependa de qué día se corra:
   * un plan arrancado en 2020 ya venció entero, y uno de 2099 todavía no
   * arrancó. En el medio, "cuántas cuotas vencieron" cambiaría cada mes.
   */
  const plan = {
    amountMinor: "50000",
    frequency: "MONTHLY" as const,
    interval: 1,
    startDate: "2020-01-05",
  };

  it("guarda el acuerdo y lo describe en una línea", async () => {
    const space = await makeSpace();
    const debtId = await addDebt(space, { plan });

    const debt = await getDebt(forSpace(space.spaceId), TIMEZONE, debtId);

    expect(debt.plan?.amount.amountMinor).toBe("50000");
    expect(debt.plan?.frequency).toBe("MONTHLY");
    expect(debt.plan?.description).toBe("Todos los meses el día 5");
    expect(debt.plan?.coversDebt).toBe(true);
  });

  it("sin plan no inventa ninguno", async () => {
    const space = await makeSpace();
    const debtId = await addDebt(space);

    const debt = await getDebt(forSpace(space.spaceId), TIMEZONE, debtId);
    expect(debt.plan).toBeNull();
  });

  it("un plan ya vencido entero espera el total, no más", async () => {
    const space = await makeSpace();
    // 5.000 en cuotas de 500 desde 2020: las diez ya vencieron.
    const debtId = await addDebt(space, { plan });

    await pay(space, debtId, { amountMinor: "200000", date: "2026-03-01" });

    const debt = await getDebt(forSpace(space.spaceId), TIMEZONE, debtId);

    expect(debt.plan?.expectedToDate.amountMinor).toBe("500000");
    expect(debt.plan?.behind.amountMinor).toBe("300000");
    expect(debt.plan?.nextDate).toBeNull();
  });

  it("sin vencimiento, el plan es lo que permite decir que está atrasada", async () => {
    const space = await makeSpace();
    const debtId = await addDebt(space, { plan });

    const debt = await getDebt(forSpace(space.spaceId), TIMEZONE, debtId);

    expect(debt.dueDate).toBeNull();
    expect(debt.status).toBe("BEHIND");
  });

  it("un plan que todavía no arrancó no atrasa nada", async () => {
    const space = await makeSpace();
    const debtId = await addDebt(space, {
      plan: { ...plan, startDate: "2099-01-05" },
    });

    const debt = await getDebt(forSpace(space.spaceId), TIMEZONE, debtId);

    expect(debt.plan?.dueCount).toBe(0);
    expect(debt.plan?.behind.amountMinor).toBe("0");
    expect(debt.plan?.nextDate).toBe("2099-01-05");
    expect(debt.status).toBe("ON_TRACK");
  });

  it("avisa cuando las cuotas pactadas no cubren la deuda", async () => {
    const space = await makeSpace();
    // Tres de 500 contra 5.000: el acuerdo no cierra.
    const debtId = await addDebt(space, {
      plan: { ...plan, startDate: "2099-01-05" },
      installmentsTotal: 3,
    });

    const debt = await getDebt(forSpace(space.spaceId), TIMEZONE, debtId);

    expect(debt.plan?.coversDebt).toBe(false);
    expect(debt.plan?.payoffDate).toBeNull();
  });

  it("se agrega y se saca de una deuda que ya existe", async () => {
    const space = await makeSpace();
    const debtId = await addDebt(space);

    await systemClient().$transaction(async (tx) =>
      updateDebt(forSpace(space.spaceId), tx, space.spaceId, debtId, { plan }),
    );

    const conPlan = await getDebt(forSpace(space.spaceId), TIMEZONE, debtId);
    expect(conPlan.plan?.amount.amountMinor).toBe("50000");

    await systemClient().$transaction(async (tx) =>
      updateDebt(forSpace(space.spaceId), tx, space.spaceId, debtId, {
        plan: null,
      }),
    );

    const sinPlan = await getDebt(forSpace(space.spaceId), TIMEZONE, debtId);
    expect(sinPlan.plan).toBeNull();
    // Y sin plan vuelve a no poder estar atrasada.
    expect(sinPlan.status).toBe("ON_TRACK");
  });

  it("editar otra cosa no borra el plan", async () => {
    const space = await makeSpace();
    const debtId = await addDebt(space, { plan });

    await systemClient().$transaction(async (tx) =>
      updateDebt(forSpace(space.spaceId), tx, space.spaceId, debtId, {
        counterparty: "Mi cuñado",
      }),
    );

    const debt = await getDebt(forSpace(space.spaceId), TIMEZONE, debtId);
    expect(debt.counterparty).toBe("Mi cuñado");
    expect(debt.plan?.amount.amountMinor).toBe("50000");
  });

  it("la base rechaza medio plan", async () => {
    // El CHECK, no Zod: un import o un arreglo a mano por psql tampoco pueden
    // dejar un importe sin frecuencia.
    const space = await makeSpace();
    const debtId = await addDebt(space);

    await expect(
      testDb.$executeRaw`UPDATE "Debt" SET "planAmountMinor" = 50000 WHERE "id" = ${debtId}`,
    ).rejects.toThrow();
  });
});

describe("un pago no es un movimiento", () => {
  it("no toca los saldos de las cuentas", async () => {
    const space = await makeSpace();
    const debtId = await addDebt(space);

    const before = await accountBalances(forSpace(space.spaceId));
    await pay(space, debtId, { amountMinor: "125000" });
    const after = await accountBalances(forSpace(space.spaceId));

    expect(after.get(space.accountId)?.balanceMinor).toBe(
      before.get(space.accountId)?.balanceMinor,
    );
  });

  it("no crea ningún movimiento", async () => {
    const space = await makeSpace();
    const debtId = await addDebt(space);

    await pay(space, debtId, { amountMinor: "125000" });

    const count = await testDb.transaction.count({
      where: { spaceId: space.spaceId },
    });
    expect(count).toBe(0);
  });
});

describe("el desembolso al crear la deuda", () => {
  it("saca la plata de la cuenta sin contarla como gasto", async () => {
    const space = await makeSpace();

    await addDebt(space, {
      direction: "OWED_TO_ME",
      counterparty: "Juan",
      accountId: space.accountId,
      createMovement: true,
    });

    const balances = await accountBalances(forSpace(space.spaceId));
    expect(balances.get(space.accountId)?.balanceMinor).toBe(500_000n);

    // No es un gasto: es una pata suelta de transferencia, sin categoría.
    const movement = await testDb.transaction.findFirstOrThrow({
      where: { spaceId: space.spaceId },
    });
    expect(movement.type).toBe("TRANSFER");
    expect(movement.transferDirection).toBe("OUT");
    expect(movement.categoryId).toBeNull();
    expect(movement.description).toBe("Préstamo a Juan");
  });

  it("un préstamo recibido entra en la cuenta sin ser un ingreso", async () => {
    const space = await makeSpace();

    await addDebt(space, {
      accountId: space.accountId,
      createMovement: true,
    });

    const balances = await accountBalances(forSpace(space.spaceId));
    expect(balances.get(space.accountId)?.balanceMinor).toBe(1_500_000n);

    const movement = await testDb.transaction.findFirstOrThrow({
      where: { spaceId: space.spaceId },
    });
    expect(movement.transferDirection).toBe("IN");
    expect(movement.description).toBe("Préstamo de Mi hermano");
  });

  it("mueve la caja de los reportes sin tocar el gasto del mes", async () => {
    const space = await makeSpace();

    const before = await monthlyReport(context(space), "es-ES", TIMEZONE, 1);
    await addDebt(space, {
      direction: "OWED_TO_ME",
      accountId: space.accountId,
      createMovement: true,
      startDate: todayIn(TIMEZONE),
    });
    const after = await monthlyReport(context(space), "es-ES", TIMEZONE, 1);

    const lastBefore = before.points.at(-1);
    const lastAfter = after.points.at(-1);

    // Prestar plata no es gastarla…
    expect(lastAfter?.expense.amountMinor).toBe(
      lastBefore?.expense.amountMinor,
    );
    // …pero la caja sí bajó, y la curva tiene que decirlo.
    expect(lastAfter?.runningBalance.amountMinor).toBe(
      String(BigInt(lastBefore?.runningBalance.amountMinor ?? "0") - 500_000n),
    );
  });

  it("sin el flag no crea ningún movimiento, como siempre", async () => {
    const space = await makeSpace();

    await addDebt(space, { accountId: space.accountId });

    const count = await testDb.transaction.count({
      where: { spaceId: space.spaceId },
    });
    expect(count).toBe(0);
  });

  it("rechaza una cuenta en otra moneda: no inventa conversiones", async () => {
    const space = await makeSpace();

    await expect(
      addDebt(space, {
        currency: "ARS",
        accountId: space.accountId,
        createMovement: true,
      }),
    ).rejects.toThrow(/coincidir/);
  });
});

describe("cierre y reapertura", () => {
  it("se cierra al cubrir el importe", async () => {
    const space = await makeSpace();
    const debtId = await addDebt(space);

    await pay(space, debtId, { amountMinor: "500000" });

    const debt = await getDebt(forSpace(space.spaceId), TIMEZONE, debtId);
    expect(debt.settled).toBe(true);
    expect(debt.closedAt).not.toBeNull();
    expect(debt.status).toBe("SETTLED");
  });

  it("guarda lo pagado de más sin pasarse del 100 %", async () => {
    const space = await makeSpace();
    const debtId = await addDebt(space);

    await pay(space, debtId, { amountMinor: "550000" });

    const debt = await getDebt(forSpace(space.spaceId), TIMEZONE, debtId);
    expect(debt.percentage).toBe(100);
    expect(debt.overpaid.amountMinor).toBe("50000");
    expect(debt.remaining.amountMinor).toBe("0");
  });

  it("borrar un pago la reabre", async () => {
    const space = await makeSpace();
    const debtId = await addDebt(space);

    const paymentId = await pay(space, debtId, { amountMinor: "500000" });

    await systemClient().$transaction(async (tx) => {
      await removePayment(
        forSpace(space.spaceId),
        tx,
        space.spaceId,
        debtId,
        paymentId,
      );
    });

    const debt = await getDebt(forSpace(space.spaceId), TIMEZONE, debtId);
    expect(debt.settled).toBe(false);
    expect(debt.closedAt).toBeNull();
  });

  it("subir el importe pactado la reabre", async () => {
    const space = await makeSpace();
    const debtId = await addDebt(space);

    await pay(space, debtId, { amountMinor: "500000" });

    await systemClient().$transaction(async (tx) => {
      await updateDebt(forSpace(space.spaceId), tx, space.spaceId, debtId, {
        originalAmountMinor: "800000",
      });
    });

    const debt = await getDebt(forSpace(space.spaceId), TIMEZONE, debtId);
    expect(debt.settled).toBe(false);
    expect(debt.closedAt).toBeNull();
  });
});

describe("cuotas", () => {
  it("cuenta los pagos registrados contra las pactadas", async () => {
    const space = await makeSpace();
    const debtId = await addDebt(space, { installmentsTotal: 4 });

    await pay(space, debtId, { amountMinor: "125000", installmentNo: 1 });
    await pay(space, debtId, { amountMinor: "125000", installmentNo: 2 });

    const debt = await getDebt(forSpace(space.spaceId), TIMEZONE, debtId);
    expect(debt.installments).toEqual({ paid: 2, total: 4 });
  });

  it("no deja repetir el número de cuota", async () => {
    const space = await makeSpace();
    const debtId = await addDebt(space, { installmentsTotal: 4 });

    await pay(space, debtId, { amountMinor: "125000", installmentNo: 1 });

    await expect(
      pay(space, debtId, { amountMinor: "125000", installmentNo: 1 }),
    ).rejects.toThrow(/cuota 1 ya está registrada/);
  });

  it("rechaza una cuota más allá de las pactadas", async () => {
    const space = await makeSpace();
    const debtId = await addDebt(space, { installmentsTotal: 4 });

    await expect(
      pay(space, debtId, { amountMinor: "125000", installmentNo: 5 }),
    ).rejects.toThrow(/se pactó en 4 cuotas/);
  });

  it("el índice de la base sigue siendo la garantía real", async () => {
    const space = await makeSpace();
    const debtId = await addDebt(space, { installmentsTotal: 4 });

    await pay(space, debtId, { amountMinor: "125000", installmentNo: 1 });

    await expect(
      forSpace(space.spaceId).debtPayment.create({
        data: {
          spaceId: space.spaceId,
          debtId,
          amountMinor: 125_000n,
          date: new Date("2026-03-01T00:00:00Z"),
          installmentNo: 1,
        },
      }),
    ).rejects.toThrow(/Unique constraint failed/);
  });
});

describe("pagos vinculados a un movimiento", () => {
  const makeExpense = async (
    space: Space,
    amountMinor: bigint,
  ): Promise<string> => {
    const created = await forSpace(space.spaceId).transaction.create({
      data: {
        spaceId: space.spaceId,
        accountId: space.accountId,
        createdByName: "Rodrigo",
        type: "EXPENSE",
        amountMinor,
        currency: space.primaryCurrency,
        date: new Date("2026-03-15T00:00:00Z"),
        description: "Cuota del préstamo",
      },
      select: { id: true },
    });
    return created.id;
  };

  it("toma el importe y la fecha del movimiento, no del body", async () => {
    const space = await makeSpace();
    const debtId = await addDebt(space);
    const transactionId = await makeExpense(space, 125_000n);

    await pay(space, debtId, { transactionId, date: "2026-01-01" });

    const debt = await getDebt(forSpace(space.spaceId), TIMEZONE, debtId);

    expect(debt.paid.amountMinor).toBe("125000");
    expect(debt.payments[0]?.date).toBe("2026-03-15");
    expect(debt.payments[0]?.transaction?.accountName).toBe("Corriente");
  });

  it("el mismo movimiento no se cuenta dos veces", async () => {
    const space = await makeSpace();
    const debtId = await addDebt(space);
    const transactionId = await makeExpense(space, 125_000n);

    await pay(space, debtId, { transactionId });

    await expect(pay(space, debtId, { transactionId })).rejects.toThrow(
      /ya está contado en esta deuda/,
    );
  });

  it("tampoco en dos deudas distintas", async () => {
    const space = await makeSpace();
    const first = await addDebt(space);
    const second = await addDebt(space, { counterparty: "El banco" });
    const transactionId = await makeExpense(space, 125_000n);

    await pay(space, first, { transactionId });

    await expect(pay(space, second, { transactionId })).rejects.toThrow(
      /ya está contado en otra deuda/,
    );
  });

  it("usa el importe ya convertido cuando la deuda está en la primaria", async () => {
    const space = await makeSpace("EUR");
    const debtId = await addDebt(space);

    const usd = await forSpace(space.spaceId).account.create({
      data: {
        spaceId: space.spaceId,
        name: "Dólares",
        type: "BANK",
        currency: "USD",
        initialBalanceMinor: 0n,
      },
      select: { id: true },
    });

    const transaction = await forSpace(space.spaceId).transaction.create({
      data: {
        spaceId: space.spaceId,
        accountId: usd.id,
        createdByName: "Rodrigo",
        type: "EXPENSE",
        amountMinor: 10_000n,
        currency: "USD",
        exchangeRateSnapshot: "0.92",
        amountPrimaryMinor: 9200n,
        date: new Date("2026-03-15T00:00:00Z"),
      },
      select: { id: true },
    });

    await pay(space, debtId, { transactionId: transaction.id });

    const debt = await getDebt(forSpace(space.spaceId), TIMEZONE, debtId);
    // 100,00 USD congelados en 92,00 €. No se recotiza nada.
    expect(debt.paid.amountMinor).toBe("9200");
  });

  it("rechaza vincular si no puede resolver la moneda sin inventar", async () => {
    const space = await makeSpace("EUR");
    const debtId = await addDebt(space, { currency: "USD" });
    const transactionId = await makeExpense(space, 125_000n); // en EUR

    await expect(pay(space, debtId, { transactionId })).rejects.toThrow(
      /cargá el pago con el importe/,
    );
  });
});

describe("posición neta", () => {
  it("caja más lo que te deben menos lo que debés", async () => {
    const space = await makeSpace();

    await addDebt(space, { originalAmountMinor: "350000" });
    await addDebt(space, {
      direction: "OWED_TO_ME",
      counterparty: "Ana",
      originalAmountMinor: "200000",
    });

    const position = await netPositionOf(
      forSpace(space.spaceId),
      context(space),
      TIMEZONE,
    );

    expect(position.accounts.amountMinor).toBe("1000000");
    expect(position.receivable.amountMinor).toBe("200000");
    expect(position.payable.amountMinor).toBe("350000");
    expect(position.net.amountMinor).toBe("850000");
  });

  it("un préstamo recién recibido sube la caja pero no el neto", async () => {
    const space = await makeSpace();

    // Entra la plata: la cuenta sube 5.000,00 €.
    await forSpace(space.spaceId).transaction.create({
      data: {
        spaceId: space.spaceId,
        accountId: space.accountId,
        createdByName: "Rodrigo",
        type: "INCOME",
        amountMinor: 500_000n,
        currency: "EUR",
        date: new Date("2026-02-01T00:00:00Z"),
        description: "Préstamo",
      },
    });

    const before = await netPositionOf(
      forSpace(space.spaceId),
      context(space),
      TIMEZONE,
    );

    // Y se anota que se deben.
    await addDebt(space, { originalAmountMinor: "500000" });

    const after = await netPositionOf(
      forSpace(space.spaceId),
      context(space),
      TIMEZONE,
    );

    // La caja no cambió entre las dos lecturas, pero el neto bajó justo lo que
    // se debe. Las dos cifras son ciertas y responden preguntas distintas.
    expect(after.accounts.amountMinor).toBe(before.accounts.amountMinor);
    expect(BigInt(after.net.amountMinor)).toBe(
      BigInt(before.net.amountMinor) - 500_000n,
    );
  });

  it("los pagos bajan lo que falta pagar", async () => {
    const space = await makeSpace();
    const debtId = await addDebt(space, { originalAmountMinor: "500000" });

    await pay(space, debtId, { amountMinor: "200000" });

    const position = await netPositionOf(
      forSpace(space.spaceId),
      context(space),
      TIMEZONE,
    );
    expect(position.payable.amountMinor).toBe("300000");
  });

  it("deja fuera las deudas en otra moneda y lo dice", async () => {
    const space = await makeSpace("EUR");

    await addDebt(space, { originalAmountMinor: "350000" });
    await addDebt(space, {
      counterparty: "En dólares",
      currency: "USD",
      originalAmountMinor: "100000",
    });

    const position = await netPositionOf(
      forSpace(space.spaceId),
      context(space),
      TIMEZONE,
    );

    // Sin cotización cargada no se inventa un número: queda afuera, pero se
    // dice cuál falta y cuánto dejó afuera.
    expect(position.payable.amountMinor).toBe("350000");
    expect(position.excludedCount).toBe(1);
    expect(position.missingRates).toEqual(["USD"]);
    expect(position.conversions).toEqual([]);
  });

  it("con la cotización cargada, la deuda en otra moneda entra convertida", async () => {
    const space = await makeSpace();
    await addRate("USD", "EUR", "0.92");

    // 1.000,00 USD a 0,92 = 920,00 €.
    await addDebt(space, {
      counterparty: "En dólares",
      currency: "USD",
      originalAmountMinor: "100000",
    });

    const position = await netPositionOf(
      forSpace(space.spaceId),
      context(space),
      TIMEZONE,
    );

    expect(position.payable.amountMinor).toBe("92000");
    expect(position.excludedCount).toBe(0);
    expect(position.missingRates).toEqual([]);
    // Y se dice con qué se convirtió: una cotización vieja convierte igual de
    // bien y el número significa otra cosa.
    expect(position.conversions).toHaveLength(1);
    expect(position.conversions[0]?.currency).toBe("USD");
    expect(position.conversions[0]?.date).toBe(RATE_DATE);
  });

  it("también convierte el saldo de las cuentas en otra moneda", async () => {
    const space = await makeSpace();
    await addRate("USD", "EUR", "0.92");

    // 10.000,00 € en la cuenta de siempre + 1.000,00 USD en otra.
    await forSpace(space.spaceId).account.create({
      data: {
        spaceId: space.spaceId,
        name: "Ahorro USD",
        type: "BANK",
        currency: "USD",
        initialBalanceMinor: 100_000n,
      },
    });

    const position = await netPositionOf(
      forSpace(space.spaceId),
      context(space),
      TIMEZONE,
    );

    expect(position.accounts.amountMinor).toBe("1092000");
    expect(position.net.amountMinor).toBe("1092000");
  });

  it("cargar la cotización que falta mete la posición adentro", async () => {
    const space = await makeSpace();
    await addDebt(space, {
      direction: "OWED_TO_ME",
      counterparty: "Me deben en dólares",
      currency: "USD",
      originalAmountMinor: "100000",
    });

    const antes = await netPositionOf(
      forSpace(space.spaceId),
      context(space),
      TIMEZONE,
    );
    expect(antes.receivable.amountMinor).toBe("0");
    expect(antes.missingRates).toEqual(["USD"]);

    await addRate("USD", "EUR", "0.92");

    const despues = await netPositionOf(
      forSpace(space.spaceId),
      context(space),
      TIMEZONE,
    );
    expect(despues.receivable.amountMinor).toBe("92000");
    expect(despues.missingRates).toEqual([]);
  });

  it("convierte cada cifra por separado, no solo el neto", async () => {
    const space = await makeSpace();
    await addRate("USD", "EUR", "0.92");

    await addDebt(space, {
      currency: "USD",
      originalAmountMinor: "100000",
    });
    await addDebt(space, {
      direction: "OWED_TO_ME",
      currency: "USD",
      originalAmountMinor: "50000",
    });

    const position = await netPositionOf(
      forSpace(space.spaceId),
      context(space),
      TIMEZONE,
    );

    // Si se convirtiera solo el neto, el desglose de arriba no sumaría el
    // total que tiene debajo.
    expect(position.payable.amountMinor).toBe("92000");
    expect(position.receivable.amountMinor).toBe("46000");
    expect(BigInt(position.net.amountMinor)).toBe(
      BigInt(position.accounts.amountMinor) + 46_000n - 92_000n,
    );
  });

  it("una moneda sin cotización no tira abajo a las que sí la tienen", async () => {
    const space = await makeSpace();
    await addRate("USD", "EUR", "0.92");

    await addDebt(space, {
      currency: "USD",
      originalAmountMinor: "100000",
    });
    await addDebt(space, {
      currency: "GBP",
      originalAmountMinor: "100000",
    });

    const position = await netPositionOf(
      forSpace(space.spaceId),
      context(space),
      TIMEZONE,
    );

    expect(position.payable.amountMinor).toBe("92000");
    expect(position.missingRates).toEqual(["GBP"]);
    expect(position.excludedCount).toBe(1);
  });

  it("una deuda saldada no cuenta", async () => {
    const space = await makeSpace();
    const debtId = await addDebt(space, { originalAmountMinor: "500000" });

    await pay(space, debtId, { amountMinor: "500000" });

    const position = await netPositionOf(
      forSpace(space.spaceId),
      context(space),
      TIMEZONE,
    );
    expect(position.payable.amountMinor).toBe("0");
  });

  it("no toca la curva de patrimonio de los reportes", async () => {
    const space = await makeSpace();

    const before = await monthlyReport(context(space), "es-ES", TIMEZONE, 3);
    await addDebt(space, { originalAmountMinor: "500000" });
    const after = await monthlyReport(context(space), "es-ES", TIMEZONE, 3);

    // Esa curva es una posición de CAJA. Meterle deudas redefiniría en silencio
    // lo que significan todos los reportes que ya existen.
    expect(after.points.map((p) => p.runningBalance.amountMinor)).toEqual(
      before.points.map((p) => p.runningBalance.amountMinor),
    );
  });
});

describe("listado y borrado", () => {
  it("oculta las saldadas salvo que se pidan", async () => {
    const space = await makeSpace();
    const done = await addDebt(space, { counterparty: "Saldada" });
    await addDebt(space, { counterparty: "Abierta" });

    await pay(space, done, { amountMinor: "500000" });

    const db = forSpace(space.spaceId);
    const open = await listDebts(db, TIMEZONE, {});
    const all = await listDebts(db, TIMEZONE, { includeSettled: true });

    expect(open.map((d) => d.counterparty)).toEqual(["Abierta"]);
    expect(all).toHaveLength(2);
  });

  it("filtra por sentido", async () => {
    const space = await makeSpace();
    await addDebt(space, { counterparty: "Debo" });
    await addDebt(space, { direction: "OWED_TO_ME", counterparty: "Me deben" });

    const owed = await listDebts(forSpace(space.spaceId), TIMEZONE, {
      direction: "OWED_TO_ME",
    });

    expect(owed.map((d) => d.counterparty)).toEqual(["Me deben"]);
  });

  it("borrar la deuda no toca los movimientos vinculados", async () => {
    const space = await makeSpace();
    const debtId = await addDebt(space);

    const created = await forSpace(space.spaceId).transaction.create({
      data: {
        spaceId: space.spaceId,
        accountId: space.accountId,
        createdByName: "Rodrigo",
        type: "EXPENSE",
        amountMinor: 125_000n,
        currency: "EUR",
        date: new Date("2026-03-15T00:00:00Z"),
      },
      select: { id: true },
    });

    await pay(space, debtId, { transactionId: created.id });

    await systemClient().$transaction(async (tx) => {
      await deleteDebt(forSpace(space.spaceId), tx, debtId);
    });

    const survivor = await forSpace(space.spaceId).transaction.findFirst({
      where: { id: created.id },
      select: { id: true },
    });
    expect(survivor).not.toBeNull();

    const debts = await listDebts(forSpace(space.spaceId), TIMEZONE, {
      includeSettled: true,
    });
    expect(debts).toHaveLength(0);
  });
});

describe("validaciones", () => {
  it("rechaza un vencimiento anterior al inicio al editar", async () => {
    const space = await makeSpace();
    const debtId = await addDebt(space, { startDate: "2026-06-01" });

    // El schema Zod solo ve lo que llega; el resultado combinado se valida en
    // el service.
    await expect(
      systemClient().$transaction(async (tx) => {
        await updateDebt(forSpace(space.spaceId), tx, space.spaceId, debtId, {
          dueDate: "2026-01-01",
        });
      }),
    ).rejects.toThrow(/anterior al inicio/);
  });
});

describe("aislamiento entre Spaces", () => {
  it("no se puede pagar una deuda de otro Space", async () => {
    const mine = await makeSpace();
    const other = await makeSpace();

    const foreign = await addDebt(other);

    await expect(pay(mine, foreign, { amountMinor: "1000" })).rejects.toThrow(
      /No se encontró la deuda/,
    );
  });

  it("no se puede vincular un movimiento de otro Space", async () => {
    const mine = await makeSpace();
    const other = await makeSpace();
    const debtId = await addDebt(mine);

    const foreign = await forSpace(other.spaceId).transaction.create({
      data: {
        spaceId: other.spaceId,
        accountId: other.accountId,
        createdByName: "Ajeno",
        type: "EXPENSE",
        amountMinor: 125_000n,
        currency: "EUR",
        date: new Date("2026-03-15T00:00:00Z"),
      },
      select: { id: true },
    });

    // 404 y no 403: confirmar que existe ya sería filtrar.
    await expect(
      pay(mine, debtId, { transactionId: foreign.id }),
    ).rejects.toThrow(/No se encontró el movimiento/);
  });

  it("la posición neta de un Space ignora las deudas del otro", async () => {
    const mine = await makeSpace();
    const other = await makeSpace();

    await addDebt(other, { originalAmountMinor: "900000" });

    const position = await netPositionOf(
      forSpace(mine.spaceId),
      context(mine),
      TIMEZONE,
    );

    expect(position.payable.amountMinor).toBe("0");
    expect(position.net.amountMinor).toBe("1000000");
  });

  it("las deudas de otro Space no se pueden leer", async () => {
    const mine = await makeSpace();
    const other = await makeSpace();
    const foreign = await addDebt(other);

    await expect(
      getDebt(forSpace(mine.spaceId), TIMEZONE, foreign),
    ).rejects.toThrow(/No se encontró la deuda/);
  });
});
