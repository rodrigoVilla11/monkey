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
import { monthlyReport } from "@/server/services/reports";

import { disconnect, resetDatabase, testDb } from "./helpers/db";

/**
 * Deudas contra Postgres real.
 *
 * Lo que más importa acá:
 *
 *  · El saldo es `original − pagos` y NO capitaliza intereses. Monkey registra,
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

const addDebt = (
  space: Space,
  over: Record<string, unknown> = {},
): Promise<string> =>
  systemClient().$transaction(async (tx) =>
    createDebt(forSpace(space.spaceId), tx, context(space), {
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

    const before = await netPositionOf(forSpace(space.spaceId), context(space));

    // Y se anota que se deben.
    await addDebt(space, { originalAmountMinor: "500000" });

    const after = await netPositionOf(forSpace(space.spaceId), context(space));

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
    );

    // Sumar monedas distintas exige una cotización, y este total no es lugar
    // para inventar una. Pero se avisa en vez de callar.
    expect(position.payable.amountMinor).toBe("350000");
    expect(position.excludedCount).toBe(1);
  });

  it("una deuda saldada no cuenta", async () => {
    const space = await makeSpace();
    const debtId = await addDebt(space, { originalAmountMinor: "500000" });

    await pay(space, debtId, { amountMinor: "500000" });

    const position = await netPositionOf(
      forSpace(space.spaceId),
      context(space),
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

    const position = await netPositionOf(forSpace(mine.spaceId), context(mine));

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
