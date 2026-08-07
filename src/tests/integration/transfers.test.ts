import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { ApiError } from "@/server/api/errors";
import { forSpace } from "@/server/db/scoped";
import { systemClient } from "@/server/db/system";
import { accountBalances } from "@/server/services/balances";
import { balanceBefore } from "@/server/db/raw/reports";
import { monthlyReport } from "@/server/services/reports";
import {
  createTransfer,
  deleteTransfer,
  getTransfer,
  updateTransfer,
} from "@/server/services/transfers";
import { listTransactions } from "@/server/services/transactions";

import { disconnect, resetDatabase, testDb } from "./helpers/db";

/**
 * Transferencias contra Postgres real.
 *
 * El test que más importa de este archivo es la NEUTRALIDAD: una transferencia
 * mueve plata entre dos cuentas y no puede cambiar el patrimonio del Space en
 * moneda primaria. Se verifica en las cinco combinaciones posibles de monedas,
 * porque cada una toma un camino distinto dentro del service.
 *
 * Lo demás que solo se puede probar con base: los CHECK y el unique parcial que
 * impiden una transferencia rota, y que un Space no pueda transferir a una
 * cuenta de otro.
 */

const TIMEZONE = "Europe/Madrid";
const DATE = "2026-08-15";

interface Space {
  readonly spaceId: string;
  readonly userId: string;
  readonly primaryCurrency: string;
}

const actor = (space: Space) => ({
  userId: space.userId,
  name: "Rodrigo",
  timezone: TIMEZONE,
});

const context = (space: Space) => ({
  spaceId: space.spaceId,
  primaryCurrency: space.primaryCurrency,
});

// Sufijo único por Space: el email de usuario es unique global.
let counter = 0;
const suffix = (): string => {
  counter += 1;
  return counter.toString().padStart(3, "0");
};

const makeSpace = async (primaryCurrency: string): Promise<Space> => {
  const label = suffix();
  const user = await testDb.user.create({
    data: {
      email: `transfer-${label}@monkey.test`,
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

  return { spaceId: space.id, userId: user.id, primaryCurrency };
};

const makeAccount = async (
  spaceId: string,
  name: string,
  currency: string,
  initialBalanceMinor = 0n,
): Promise<string> => {
  const account = await forSpace(spaceId).account.create({
    data: {
      spaceId,
      name,
      type: "BANK",
      currency,
      initialBalanceMinor,
    },
  });
  return account.id;
};

/** Ejecuta el service como lo hace el endpoint: dentro de una transacción. */
const runCreate = (
  space: Space,
  input: Parameters<typeof createTransfer>[4],
): Promise<string> =>
  systemClient().$transaction(async (tx) =>
    createTransfer(
      forSpace(space.spaceId),
      tx,
      context(space),
      actor(space),
      input,
    ),
  );

/**
 * Patrimonio del Space en moneda primaria: apertura de todas las cuentas más
 * los movimientos con signo. Es la misma función que alimenta el cash flow de
 * los reportes.
 */
const netWorth = (spaceId: string): Promise<bigint> =>
  balanceBefore(spaceId, new Date("2100-01-01T00:00:00Z"));

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await disconnect();
});

describe("una transferencia no cambia el patrimonio del Space", () => {
  /**
   * Las cinco formas que puede tomar una transferencia según dónde esté la
   * moneda primaria. Cada una entra por una rama distinta de `resolveTransfer`,
   * y en las cinco el patrimonio tiene que quedar exactamente igual.
   */
  const CASES = [
    {
      label: "las dos cuentas en la moneda primaria",
      primary: "EUR",
      from: "EUR",
      to: "EUR",
      out: 50_000n,
      in: undefined,
    },
    {
      label: "origen en la primaria, destino en otra moneda",
      primary: "EUR",
      from: "EUR",
      to: "ARS",
      out: 50_000n,
      in: 57_525_000n,
    },
    {
      label: "destino en la primaria, origen en otra moneda",
      primary: "EUR",
      from: "ARS",
      to: "EUR",
      out: 57_525_000n,
      in: 49_000n, // llegaron menos euros: el banco se quedó con lo suyo
    },
    {
      label: "las dos en la misma moneda, ninguna la primaria",
      primary: "EUR",
      from: "USD",
      to: "USD",
      out: 20_000n,
      in: undefined,
    },
    {
      label: "dos monedas distintas y ninguna la primaria",
      primary: "EUR",
      from: "USD",
      to: "ARS",
      out: 20_000n,
      in: 20_000_000n,
    },
  ] as const;

  for (const testCase of CASES) {
    it(`queda neutra con ${testCase.label}`, async () => {
      const space = await makeSpace(testCase.primary);

      // Cotizaciones para los casos donde ninguna cuenta está en la primaria.
      await testDb.exchangeRate.create({
        data: {
          baseCurrency: "USD",
          quoteCurrency: "EUR",
          rate: "0.92",
          date: new Date(`${DATE}T00:00:00Z`),
          source: "test",
        },
      });

      const from = await makeAccount(
        space.spaceId,
        "Origen",
        testCase.from,
        1_000_000n,
      );
      const to = await makeAccount(
        space.spaceId,
        "Destino",
        testCase.to,
        1_000_000n,
      );

      const before = await netWorth(space.spaceId);

      await runCreate(space, {
        fromAccountId: from,
        toAccountId: to,
        amountOutMinor: testCase.out.toString(),
        ...(testCase.in !== undefined
          ? { amountInMinor: testCase.in.toString() }
          : {}),
        date: DATE,
      });

      expect(await netWorth(space.spaceId)).toBe(before);
    });
  }

  it("las dos patas valen lo mismo en moneda primaria", async () => {
    const space = await makeSpace("EUR");
    const from = await makeAccount(space.spaceId, "Euros", "EUR", 1_000_000n);
    const to = await makeAccount(space.spaceId, "Pesos", "ARS");

    await runCreate(space, {
      fromAccountId: from,
      toAccountId: to,
      amountOutMinor: "50000",
      amountInMinor: "57525000",
      date: DATE,
    });

    const legs = await testDb.transaction.findMany({
      where: { spaceId: space.spaceId },
      select: {
        transferDirection: true,
        amountMinor: true,
        amountPrimaryMinor: true,
        currency: true,
      },
    });

    const out = legs.find((leg) => leg.transferDirection === "OUT");
    const incoming = legs.find((leg) => leg.transferDirection === "IN");

    // La pata en moneda primaria no lleva conversión: su valor es su importe.
    expect(out?.amountPrimaryMinor).toBeNull();
    expect(out?.amountMinor).toBe(50_000n);
    // La otra vale exactamente lo mismo, no lo que diría una cotización de
    // mercado. Eso es lo que la mantiene neutra.
    expect(incoming?.amountPrimaryMinor).toBe(50_000n);
  });

  it("el cash flow mensual no se mueve por una transferencia", async () => {
    const space = await makeSpace("EUR");
    const from = await makeAccount(space.spaceId, "Banco", "EUR", 1_000_000n);
    const to = await makeAccount(space.spaceId, "Pesos", "ARS");

    const before = await monthlyReport(context(space), "es-ES", TIMEZONE, 3);

    await runCreate(space, {
      fromAccountId: from,
      toAccountId: to,
      amountOutMinor: "50000",
      amountInMinor: "57525000",
      date: DATE,
    });

    const after = await monthlyReport(context(space), "es-ES", TIMEZONE, 3);

    // Ni ingresos, ni gastos, ni patrimonio acumulado.
    expect(after.points.map((p) => p.income.amountMinor)).toEqual(
      before.points.map((p) => p.income.amountMinor),
    );
    expect(after.points.map((p) => p.expense.amountMinor)).toEqual(
      before.points.map((p) => p.expense.amountMinor),
    );
    expect(after.points.map((p) => p.runningBalance.amountMinor)).toEqual(
      before.points.map((p) => p.runningBalance.amountMinor),
    );
  });
});

describe("saldos de las cuentas", () => {
  it("resta del origen y suma al destino", async () => {
    const space = await makeSpace("EUR");
    const from = await makeAccount(space.spaceId, "Banco", "EUR", 100_000n);
    const to = await makeAccount(space.spaceId, "Efectivo", "EUR", 20_000n);

    await runCreate(space, {
      fromAccountId: from,
      toAccountId: to,
      amountOutMinor: "30000",
      date: DATE,
    });

    const balances = await accountBalances(forSpace(space.spaceId));

    expect(balances.get(from)?.balanceMinor).toBe(70_000n);
    expect(balances.get(to)?.balanceMinor).toBe(50_000n);
  });

  it("cada cuenta se mueve en SU moneda, no en la convertida", async () => {
    const space = await makeSpace("EUR");
    const from = await makeAccount(space.spaceId, "Euros", "EUR", 100_000n);
    const to = await makeAccount(space.spaceId, "Pesos", "ARS", 1_000_000n);

    await runCreate(space, {
      fromAccountId: from,
      toAccountId: to,
      amountOutMinor: "50000",
      amountInMinor: "57525000",
      date: DATE,
    });

    const balances = await accountBalances(forSpace(space.spaceId));

    expect(balances.get(from)?.balanceMinor).toBe(50_000n);
    expect(balances.get(to)?.balanceMinor).toBe(58_525_000n);
  });
});

describe("validaciones", () => {
  it("rechaza transferir una cuenta a sí misma", async () => {
    const space = await makeSpace("EUR");
    const account = await makeAccount(space.spaceId, "Banco", "EUR");

    await expect(
      runCreate(space, {
        fromAccountId: account,
        toAccountId: account,
        amountOutMinor: "1000",
        date: DATE,
      }),
    ).rejects.toThrow(ApiError);
  });

  it("exige el importe de destino entre monedas distintas", async () => {
    const space = await makeSpace("EUR");
    const from = await makeAccount(space.spaceId, "Euros", "EUR");
    const to = await makeAccount(space.spaceId, "Pesos", "ARS");

    await expect(
      runCreate(space, {
        fromAccountId: from,
        toAccountId: to,
        amountOutMinor: "50000",
        date: DATE,
      }),
    ).rejects.toThrow(/monedas distintas/);
  });

  it("rechaza un importe de destino distinto en la misma moneda", async () => {
    const space = await makeSpace("EUR");
    const from = await makeAccount(space.spaceId, "Banco", "EUR");
    const to = await makeAccount(space.spaceId, "Efectivo", "EUR");

    await expect(
      runCreate(space, {
        fromAccountId: from,
        toAccountId: to,
        amountOutMinor: "50000",
        amountInMinor: "49000",
        date: DATE,
      }),
    ).rejects.toThrow(/lo mismo que sale/);
  });

  it("rechaza una cuenta archivada", async () => {
    const space = await makeSpace("EUR");
    const from = await makeAccount(space.spaceId, "Banco", "EUR");
    const to = await makeAccount(space.spaceId, "Vieja", "EUR");

    await forSpace(space.spaceId).account.update({
      where: { id: to },
      data: { isArchived: true },
    });

    await expect(
      runCreate(space, {
        fromAccountId: from,
        toAccountId: to,
        amountOutMinor: "1000",
        date: DATE,
      }),
    ).rejects.toThrow(/archivada/);
  });

  it("falla si ninguna cuenta está en la primaria y no hay cotización", async () => {
    const space = await makeSpace("EUR");
    const from = await makeAccount(space.spaceId, "Dólares", "USD");
    const to = await makeAccount(space.spaceId, "Pesos", "ARS");

    await expect(
      runCreate(space, {
        fromAccountId: from,
        toAccountId: to,
        amountOutMinor: "20000",
        amountInMinor: "20000000",
        date: DATE,
      }),
    ).rejects.toThrow(/cotización/);
  });

  it("acepta una cotización explícita cuando no hay ninguna cargada", async () => {
    const space = await makeSpace("EUR");
    const from = await makeAccount(space.spaceId, "Dólares", "USD", 100_000n);
    const to = await makeAccount(space.spaceId, "Pesos", "ARS");

    const id = await runCreate(space, {
      fromAccountId: from,
      toAccountId: to,
      amountOutMinor: "20000",
      amountInMinor: "20000000",
      exchangeRate: "0.92",
      date: DATE,
    });

    const transfer = await getTransfer(forSpace(space.spaceId), "EUR", id);

    // 200,00 USD × 0,92 = 184,00 €
    expect(transfer.amountPrimary.amountMinor).toBe("18400");
  });
});

describe("la base impide una transferencia rota", () => {
  it("no deja una transferencia con categoría", async () => {
    const space = await makeSpace("EUR");
    const account = await makeAccount(space.spaceId, "Banco", "EUR");
    const db = forSpace(space.spaceId);

    const category = await db.category.create({
      data: { spaceId: space.spaceId, name: "Comida", kind: "EXPENSE" },
    });

    await expect(
      db.transaction.create({
        data: {
          spaceId: space.spaceId,
          accountId: account,
          categoryId: category.id,
          createdByName: "Rodrigo",
          type: "TRANSFER",
          transferGroupId: "grupo-1",
          transferDirection: "OUT",
          amountMinor: 1000n,
          currency: "EUR",
          date: new Date(`${DATE}T00:00:00Z`),
        },
      }),
    ).rejects.toThrow(/Transaction_transfer_has_no_category/);
  });

  it("no deja dos patas del mismo sentido en un grupo", async () => {
    const space = await makeSpace("EUR");
    const account = await makeAccount(space.spaceId, "Banco", "EUR");
    const db = forSpace(space.spaceId);

    const leg = {
      spaceId: space.spaceId,
      accountId: account,
      createdByName: "Rodrigo",
      type: "TRANSFER" as const,
      transferGroupId: "grupo-duplicado",
      transferDirection: "OUT" as const,
      amountMinor: 1000n,
      currency: "EUR",
      date: new Date(`${DATE}T00:00:00Z`),
    };

    await db.transaction.create({ data: leg });

    // Prisma nombra los campos del unique, no el índice parcial que lo aplica.
    await expect(db.transaction.create({ data: leg })).rejects.toThrow(
      /Unique constraint failed[\s\S]*transferGroupId[\s\S]*transferDirection/,
    );
  });

  it("deja recrear una transferencia después de borrar la anterior", async () => {
    const space = await makeSpace("EUR");
    const from = await makeAccount(space.spaceId, "Banco", "EUR", 100_000n);
    const to = await makeAccount(space.spaceId, "Efectivo", "EUR");

    const id = await runCreate(space, {
      fromAccountId: from,
      toAccountId: to,
      amountOutMinor: "10000",
      date: DATE,
    });

    await systemClient().$transaction(async (tx) => {
      await deleteTransfer(forSpace(space.spaceId), tx, id);
    });

    // El unique es parcial por deletedAt: la borrada no bloquea a la nueva.
    await expect(
      runCreate(space, {
        fromAccountId: from,
        toAccountId: to,
        amountOutMinor: "10000",
        date: DATE,
      }),
    ).resolves.toBeTypeOf("string");
  });
});

describe("borrado", () => {
  it("borra las dos patas juntas", async () => {
    const space = await makeSpace("EUR");
    const from = await makeAccount(space.spaceId, "Banco", "EUR", 100_000n);
    const to = await makeAccount(space.spaceId, "Efectivo", "EUR");

    const id = await runCreate(space, {
      fromAccountId: from,
      toAccountId: to,
      amountOutMinor: "30000",
      date: DATE,
    });

    await systemClient().$transaction(async (tx) => {
      await deleteTransfer(forSpace(space.spaceId), tx, id);
    });

    const balances = await accountBalances(forSpace(space.spaceId));
    expect(balances.get(from)?.balanceMinor).toBe(100_000n);
    expect(balances.get(to)?.balanceMinor).toBe(0n);
  });
});

describe("edición", () => {
  it("cambia las dos patas a la vez y sigue neutra", async () => {
    const space = await makeSpace("EUR");
    const from = await makeAccount(space.spaceId, "Euros", "EUR", 1_000_000n);
    const to = await makeAccount(space.spaceId, "Pesos", "ARS");

    const id = await runCreate(space, {
      fromAccountId: from,
      toAccountId: to,
      amountOutMinor: "50000",
      amountInMinor: "57525000",
      date: DATE,
    });

    const before = await netWorth(space.spaceId);

    await systemClient().$transaction(async (tx) => {
      await updateTransfer(forSpace(space.spaceId), tx, context(space), id, {
        amountOutMinor: "60000",
        amountInMinor: "69000000",
      });
    });

    const transfer = await getTransfer(forSpace(space.spaceId), "EUR", id);

    expect(transfer.amountOut.amountMinor).toBe("60000");
    expect(transfer.amountIn.amountMinor).toBe("69000000");
    expect(transfer.amountPrimary.amountMinor).toBe("60000");
    expect(await netWorth(space.spaceId)).toBe(before);
  });

  it("corregir solo el importe basta si las dos cuentas comparten moneda", async () => {
    // Regresión: se arrastraba el importe de destino anterior y la propia
    // validación de "tiene que entrar lo mismo que sale" rechazaba la edición.
    const space = await makeSpace("EUR");
    const from = await makeAccount(space.spaceId, "Banco", "EUR", 100_000n);
    const to = await makeAccount(space.spaceId, "Efectivo", "EUR");

    const id = await runCreate(space, {
      fromAccountId: from,
      toAccountId: to,
      amountOutMinor: "25000",
      date: DATE,
    });

    await systemClient().$transaction(async (tx) => {
      await updateTransfer(forSpace(space.spaceId), tx, context(space), id, {
        amountOutMinor: "30000",
      });
    });

    const transfer = await getTransfer(forSpace(space.spaceId), "EUR", id);

    expect(transfer.amountOut.amountMinor).toBe("30000");
    // El importe de destino sigue al de origen sin que haya que repetirlo.
    expect(transfer.amountIn.amountMinor).toBe("30000");

    const balances = await accountBalances(forSpace(space.spaceId));
    expect(balances.get(from)?.balanceMinor).toBe(70_000n);
    expect(balances.get(to)?.balanceMinor).toBe(30_000n);
  });

  it("recalcula la conversión al cambiar la cuenta de destino", async () => {
    const space = await makeSpace("EUR");
    const from = await makeAccount(space.spaceId, "Euros", "EUR", 1_000_000n);
    const pesos = await makeAccount(space.spaceId, "Pesos", "ARS");
    const otros = await makeAccount(space.spaceId, "Otra en euros", "EUR");

    const id = await runCreate(space, {
      fromAccountId: from,
      toAccountId: pesos,
      amountOutMinor: "50000",
      amountInMinor: "57525000",
      date: DATE,
    });

    await systemClient().$transaction(async (tx) => {
      await updateTransfer(forSpace(space.spaceId), tx, context(space), id, {
        toAccountId: otros,
      });
    });

    const transfer = await getTransfer(forSpace(space.spaceId), "EUR", id);

    // El destino ahora está en euros: entra lo mismo que sale y la conversión
    // desaparece. Reusar los 57.525.000 pesos habría inventado plata.
    expect(transfer.amountIn).toEqual({
      amountMinor: "50000",
      currency: "EUR",
    });
    expect(transfer.rate).toBeNull();

    const legs = await testDb.transaction.findMany({
      where: { spaceId: space.spaceId, deletedAt: null },
      select: { amountPrimaryMinor: true, exchangeRateSnapshot: true },
    });
    expect(legs.every((leg) => leg.amountPrimaryMinor === null)).toBe(true);
    expect(legs.every((leg) => leg.exchangeRateSnapshot === null)).toBe(true);
  });
});

describe("lectura", () => {
  it("expone la cotización real de la operación", async () => {
    const space = await makeSpace("EUR");
    const from = await makeAccount(space.spaceId, "Euros", "EUR", 1_000_000n);
    const to = await makeAccount(space.spaceId, "Pesos", "ARS");

    const id = await runCreate(space, {
      fromAccountId: from,
      toAccountId: to,
      amountOutMinor: "50000",
      amountInMinor: "57525000",
      date: DATE,
    });

    const transfer = await getTransfer(forSpace(space.spaceId), "EUR", id);

    // 575.250,00 ARS / 500,00 EUR = 1150,50 pesos por euro.
    expect(transfer.rate).toBe("1150.5");
    expect(transfer.from.name).toBe("Euros");
    expect(transfer.to.name).toBe("Pesos");
  });

  it("el listado de movimientos trae la contraparte de cada pata", async () => {
    const space = await makeSpace("EUR");
    const from = await makeAccount(space.spaceId, "Banco", "EUR", 100_000n);
    const to = await makeAccount(space.spaceId, "Efectivo", "EUR");

    await runCreate(space, {
      fromAccountId: from,
      toAccountId: to,
      amountOutMinor: "30000",
      date: DATE,
    });

    const page = await listTransactions(
      forSpace(space.spaceId),
      "EUR",
      {},
      { limit: 20 },
    );

    const out = page.items.find((item) => item.transferDirection === "OUT");
    const incoming = page.items.find((item) => item.transferDirection === "IN");

    expect(out?.transferCounterpartAccount?.name).toBe("Efectivo");
    expect(incoming?.transferCounterpartAccount?.name).toBe("Banco");
  });

  it("un movimiento normal no trae contraparte", async () => {
    const space = await makeSpace("EUR");
    const account = await makeAccount(space.spaceId, "Banco", "EUR");
    const db = forSpace(space.spaceId);

    await db.transaction.create({
      data: {
        spaceId: space.spaceId,
        accountId: account,
        createdByName: "Rodrigo",
        type: "EXPENSE",
        amountMinor: 1000n,
        currency: "EUR",
        date: new Date(`${DATE}T00:00:00Z`),
      },
    });

    const page = await listTransactions(db, "EUR", {}, { limit: 20 });

    expect(page.items[0]?.transferCounterpartAccount).toBeNull();
    expect(page.items[0]?.transferDirection).toBeNull();
  });
});

describe("aislamiento entre Spaces", () => {
  it("no se puede transferir a una cuenta de otro Space", async () => {
    const mine = await makeSpace("EUR");
    const other = await makeSpace("EUR");

    const from = await makeAccount(mine.spaceId, "Mi banco", "EUR", 100_000n);
    const foreign = await makeAccount(other.spaceId, "Ajena", "EUR");

    // 404 y no 403: confirmar que la cuenta existe ya sería filtrar.
    await expect(
      runCreate(mine, {
        fromAccountId: from,
        toAccountId: foreign,
        amountOutMinor: "1000",
        date: DATE,
      }),
    ).rejects.toThrow(/No se encontró la cuenta de destino/);
  });

  it("no se puede leer la transferencia de otro Space", async () => {
    const mine = await makeSpace("EUR");
    const other = await makeSpace("EUR");

    const from = await makeAccount(other.spaceId, "Banco", "EUR", 100_000n);
    const to = await makeAccount(other.spaceId, "Efectivo", "EUR");

    const id = await runCreate(other, {
      fromAccountId: from,
      toAccountId: to,
      amountOutMinor: "10000",
      date: DATE,
    });

    await expect(
      getTransfer(forSpace(mine.spaceId), "EUR", id),
    ).rejects.toThrow(/No se encontró la transferencia/);
  });

  it("no se puede borrar la transferencia de otro Space", async () => {
    const mine = await makeSpace("EUR");
    const other = await makeSpace("EUR");

    const from = await makeAccount(other.spaceId, "Banco", "EUR", 100_000n);
    const to = await makeAccount(other.spaceId, "Efectivo", "EUR");

    const id = await runCreate(other, {
      fromAccountId: from,
      toAccountId: to,
      amountOutMinor: "10000",
      date: DATE,
    });

    await expect(
      systemClient().$transaction(async (tx) => {
        await deleteTransfer(forSpace(mine.spaceId), tx, id);
      }),
    ).rejects.toThrow(/No se encontró la transferencia/);

    // Y la del otro sigue intacta.
    const balances = await accountBalances(forSpace(other.spaceId));
    expect(balances.get(from)?.balanceMinor).toBe(90_000n);
  });
});
