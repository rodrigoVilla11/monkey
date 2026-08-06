import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { forSpace } from "@/server/db/scoped";
import { createBudget } from "@/server/services/budgets";
import { getDashboard } from "@/server/services/reports/dashboard";

import { disconnect, resetDatabase, testDb } from "./helpers/db";

/**
 * Agregación de importes en un Space con varias monedas.
 *
 * `Transaction.amountPrimaryMinor` SOLO está poblado cuando la moneda del
 * movimiento difiere de la primaria del Space. Eso hace que sumar las dos
 * columnas por separado sea una trampa:
 *
 *   · `SUM(amountMinor)`        cubre TODAS las filas, en monedas mezcladas
 *   · `SUM(amountPrimaryMinor)` cubre solo las convertidas
 *
 * Quedarse con una u otra según cuál sea mayor que cero —que es lo que hacía
 * el código— descarta en silencio los movimientos que ya estaban en la moneda
 * primaria en cuanto aparece uno en otra moneda.
 *
 * Estos tests fijan el comportamiento correcto: sumar las que están en moneda
 * primaria con las convertidas de las demás.
 */

const TIMEZONE = "Europe/Madrid";

let spaceId = "";
let accountId = "";
let categoryId = "";
let userId = "";

beforeEach(async () => {
  await resetDatabase();

  const user = await testDb.user.create({
    data: {
      email: "mixto@monedas.test",
      passwordHash: "hash",
      name: "Rodrigo",
      timezone: TIMEZONE,
      locale: "es-ES",
      emailVerifiedAt: new Date(),
    },
  });

  const space = await testDb.space.create({
    data: {
      name: "Space en EUR",
      primaryCurrency: "EUR",
      timezone: TIMEZONE,
      memberships: { create: { userId: user.id, role: "OWNER" } },
    },
  });

  const db = forSpace(space.id);

  const account = await db.account.create({
    data: {
      spaceId: space.id,
      name: "Cuenta",
      type: "BANK",
      currency: "EUR",
      initialBalanceMinor: 0n,
    },
  });

  const category = await db.category.create({
    data: { spaceId: space.id, name: "Viajes", kind: "EXPENSE" },
  });

  spaceId = space.id;
  accountId = account.id;
  categoryId = category.id;
  userId = user.id;
});

afterAll(async () => {
  await resetDatabase();
  await disconnect();
});

const today = (): string =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

/** Gasto en la moneda primaria: `amountPrimaryMinor` queda en null. */
const spendInPrimary = async (amountMinor: bigint): Promise<void> => {
  await forSpace(spaceId).transaction.create({
    data: {
      spaceId,
      accountId,
      categoryId,
      createdByUserId: userId,
      createdByName: "Rodrigo",
      type: "EXPENSE",
      amountMinor,
      currency: "EUR",
      date: new Date(`${today()}T00:00:00Z`),
    },
  });
};

/** Gasto en otra moneda: lleva la conversión congelada. */
const spendInForeign = async (
  amountMinor: bigint,
  primaryMinor: bigint,
): Promise<void> => {
  await forSpace(spaceId).transaction.create({
    data: {
      spaceId,
      accountId,
      categoryId,
      createdByUserId: userId,
      createdByName: "Rodrigo",
      type: "EXPENSE",
      amountMinor,
      currency: "ARS",
      amountPrimaryMinor: primaryMinor,
      exchangeRateSnapshot: "0.00087",
      date: new Date(`${today()}T00:00:00Z`),
    },
  });
};

describe("dashboard con monedas mezcladas", () => {
  it("suma las de moneda primaria MÁS las convertidas", async () => {
    await spendInPrimary(10_000n); // 100,00 €
    await spendInForeign(1_500_000n, 13_050n); // 15.000,00 ARS = 130,50 €

    const dashboard = await getDashboard(
      forSpace(spaceId),
      { primaryCurrency: "EUR", timezone: TIMEZONE },
      TIMEZONE,
    );

    // 100,00 + 130,50 = 230,50 €. El bug daba 130,50: descartaba el gasto
    // que ya estaba en euros en cuanto aparecía uno en pesos.
    expect(dashboard.month.expense.amountMinor).toBe("23050");
  });

  it("no cambia nada cuando hay una sola moneda", async () => {
    await spendInPrimary(10_000n);
    await spendInPrimary(5_000n);

    const dashboard = await getDashboard(
      forSpace(spaceId),
      { primaryCurrency: "EUR", timezone: TIMEZONE },
      TIMEZONE,
    );

    expect(dashboard.month.expense.amountMinor).toBe("15000");
  });

  it("el desglose por categoría también suma las dos", async () => {
    await spendInPrimary(10_000n);
    await spendInForeign(1_500_000n, 13_050n);

    const dashboard = await getDashboard(
      forSpace(spaceId),
      { primaryCurrency: "EUR", timezone: TIMEZONE },
      TIMEZONE,
    );

    const viajes = dashboard.topExpenseCategories.find(
      (c) => c.name === "Viajes",
    );
    expect(viajes?.total.amountMinor).toBe("23050");
  });
});

describe("presupuestos con monedas mezcladas", () => {
  it("cuenta las de moneda primaria MÁS las convertidas", async () => {
    await spendInPrimary(10_000n);
    await spendInForeign(1_500_000n, 13_050n);

    const budget = await createBudget(
      forSpace(spaceId),
      spaceId,
      "EUR",
      TIMEZONE,
      {
        name: "Viajes",
        period: "MONTHLY",
        amountMinor: "50000",
        categoryId,
        startDate: "2020-01-01",
      },
    );

    expect(budget.spent.amountMinor).toBe("23050");
    expect(budget.remaining.amountMinor).toBe("26950");
  });
});
