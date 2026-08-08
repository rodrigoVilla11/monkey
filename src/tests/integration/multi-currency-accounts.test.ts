import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { forSpace } from "@/server/db/scoped";
import { systemClient } from "@/server/db/system";
import {
  createAccount,
  listAccounts,
  updateAccount,
} from "@/server/services/accounts";
import { createRate, listRates } from "@/server/services/rates/manage";
import { getDashboard } from "@/server/services/reports/dashboard";

import { disconnect, resetDatabase, testDb } from "./helpers/db";

/**
 * Cuentas en varias monedas y el interruptor de "contar en el inicio".
 *
 * Lo que importa:
 *
 *  · Una cuenta fuera del inicio NO aparece en el resumen NI suma al
 *    patrimonio. Que fuera solo una de las dos cosas dejaría un total que no se
 *    puede explicar mirando la lista.
 *  · Sus movimientos SIGUEN contando en los reportes: el interruptor decide qué
 *    es "lo mío de todos los días", no qué existe.
 *  · Sin cotización no se inventa un número: se dice cuál falta.
 */

const TIMEZONE = "Europe/Madrid";
const TODAY = "2026-08-08";

interface Space {
  readonly spaceId: string;
  readonly userId: string;
}

let counter = 0;

const makeSpace = async (primaryCurrency = "EUR"): Promise<Space> => {
  counter += 1;
  const label = counter.toString().padStart(3, "0");

  const user = await testDb.user.create({
    data: {
      email: `multi-${label}@monkey.test`,
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

  return { spaceId: space.id, userId: user.id };
};

const addAccount = (
  space: Space,
  name: string,
  currency: string,
  initialBalanceMinor: string,
  includeInNetWorth = true,
) =>
  createAccount(
    forSpace(space.spaceId),
    space.spaceId,
    {
      name,
      type: "BANK",
      currency,
      initialBalanceMinor,
      includeInNetWorth,
    },
    "EUR",
  );

const addRate = (base: string, quote: string, rate: string) =>
  systemClient().$transaction(async (tx) =>
    createRate(tx, TIMEZONE, {
      baseCurrency: base,
      quoteCurrency: quote,
      rate,
      date: TODAY,
    }),
  );

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await disconnect();
});

describe("cuentas en otra moneda", () => {
  it("se crean con su propia moneda", async () => {
    const space = await makeSpace("EUR");
    await addAccount(space, "Dólares", "USD", "100000");

    const accounts = await listAccounts(forSpace(space.spaceId), {});

    expect(accounts[0]?.currency).toBe("USD");
    expect(accounts[0]?.balance.amountMinor).toBe("100000");
  });

  it("el saldo se convierte a la primaria al tipo de HOY", async () => {
    const space = await makeSpace("EUR");
    await addAccount(space, "Dólares", "USD", "100000");
    await addRate("USD", "EUR", "0.92");

    const accounts = await listAccounts(forSpace(space.spaceId), {
      primaryCurrency: "EUR",
      today: TODAY,
    });

    // 1.000,00 USD × 0,92 = 920,00 €
    expect(accounts[0]?.balancePrimary).toEqual({
      amountMinor: "92000",
      currency: "EUR",
    });
  });

  it("sin cotización NO se inventa un número", async () => {
    const space = await makeSpace("EUR");
    await addAccount(space, "Dólares", "USD", "100000");

    const accounts = await listAccounts(forSpace(space.spaceId), {
      primaryCurrency: "EUR",
      today: TODAY,
    });

    expect(accounts[0]?.balancePrimary).toBeNull();
  });

  it("una cuenta en la primaria no repite el número convertido", async () => {
    const space = await makeSpace("EUR");
    await addAccount(space, "Corriente", "EUR", "50000");

    const accounts = await listAccounts(forSpace(space.spaceId), {
      primaryCurrency: "EUR",
      today: TODAY,
    });

    // Mostrarlo dos veces sugeriría que son dos cifras distintas.
    expect(accounts[0]?.balancePrimary).toBeNull();
  });

  it("la cotización inversa también sirve", async () => {
    const space = await makeSpace("EUR");
    await addAccount(space, "Dólares", "USD", "100000");
    // Se carga EUR→USD y se pide USD→EUR.
    await addRate("EUR", "USD", "1.25");

    const accounts = await listAccounts(forSpace(space.spaceId), {
      primaryCurrency: "EUR",
      today: TODAY,
    });

    // 1.000,00 USD ÷ 1,25 = 800,00 €
    expect(accounts[0]?.balancePrimary?.amountMinor).toBe("80000");
  });
});

describe("el interruptor del inicio", () => {
  const setup = async (): Promise<Space> => {
    const space = await makeSpace("EUR");
    await addAccount(space, "Corriente", "EUR", "100000");
    await addAccount(space, "Apartada", "EUR", "500000", false);
    return space;
  };

  it("una cuenta fuera del inicio no suma al patrimonio", async () => {
    const space = await setup();

    const result = await getDashboard(
      forSpace(space.spaceId),
      { primaryCurrency: "EUR", timezone: TIMEZONE },
      TIMEZONE,
    );

    // 1.000,00 € y no 6.000,00 €.
    expect(result.netWorth.byCurrency[0]?.amountMinor).toBe("100000");
  });

  it("tampoco aparece en la lista del resumen", async () => {
    const space = await setup();

    const result = await getDashboard(
      forSpace(space.spaceId),
      { primaryCurrency: "EUR", timezone: TIMEZONE },
      TIMEZONE,
    );

    // Las dos cosas van juntas: un total que no se puede explicar mirando la
    // lista de abajo es peor que no mostrarlo.
    expect(result.accounts.map((a: { name: string }) => a.name)).toEqual([
      "Corriente",
    ]);
  });

  it("pero SÍ aparece en la pantalla de cuentas", async () => {
    const space = await setup();

    const accounts = await listAccounts(forSpace(space.spaceId), {});

    expect(accounts.map((a) => a.name)).toEqual(["Corriente", "Apartada"]);
    expect(accounts.find((a) => a.name === "Apartada")?.includeInNetWorth).toBe(
      false,
    );
  });

  it("sus movimientos siguen contando en los reportes", async () => {
    const space = await setup();
    const accounts = await listAccounts(forSpace(space.spaceId), {});
    const apartada = accounts.find((a) => a.name === "Apartada");

    await forSpace(space.spaceId).transaction.create({
      data: {
        spaceId: space.spaceId,
        accountId: apartada?.id ?? "",
        createdByName: "Rodrigo",
        type: "EXPENSE",
        amountMinor: 25_000n,
        currency: "EUR",
        date: new Date(`${TODAY}T00:00:00Z`),
        description: "Gasto de la apartada",
      },
    });

    const result = await getDashboard(
      forSpace(space.spaceId),
      { primaryCurrency: "EUR", timezone: TIMEZONE },
      TIMEZONE,
      TODAY,
    );

    // El interruptor decide qué es "lo mío de todos los días", no qué existe.
    expect(result.month.expense.amountMinor).toBe("25000");
  });

  it("se puede volver a meter en el inicio", async () => {
    const space = await setup();
    const accounts = await listAccounts(forSpace(space.spaceId), {});
    const apartada = accounts.find((a) => a.name === "Apartada");

    await updateAccount(forSpace(space.spaceId), apartada?.id ?? "", {
      includeInNetWorth: true,
    });

    const result = await getDashboard(
      forSpace(space.spaceId),
      { primaryCurrency: "EUR", timezone: TIMEZONE },
      TIMEZONE,
    );

    expect(result.netWorth.byCurrency[0]?.amountMinor).toBe("600000");
  });

  it("por defecto una cuenta nueva cuenta para el inicio", async () => {
    const space = await makeSpace("EUR");
    const created = await addAccount(space, "Nueva", "EUR", "0");

    expect(created.includeInNetWorth).toBe(true);
  });
});

describe("cotizaciones", () => {
  it("dice qué pares faltan según las cuentas del Space", async () => {
    const space = await makeSpace("EUR");
    await addAccount(space, "Dólares", "USD", "100000");
    await addAccount(space, "Libras", "GBP", "50000");

    const result = await listRates(
      forSpace(space.spaceId),
      { primaryCurrency: "EUR", timezone: TIMEZONE },
      {},
    );

    // Sin esto la pantalla sería un formulario a ciegas.
    expect(result.missing.map((m) => m.baseCurrency).sort()).toEqual([
      "GBP",
      "USD",
    ]);
    expect(result.missing[0]?.reason).toMatch(/Cuenta/);
  });

  it("deja de reclamar la que ya se cargó", async () => {
    const space = await makeSpace("EUR");
    await addAccount(space, "Dólares", "USD", "100000");
    await addRate("USD", "EUR", "0.92");

    const result = await listRates(
      forSpace(space.spaceId),
      { primaryCurrency: "EUR", timezone: TIMEZONE },
      {},
    );

    expect(result.missing).toHaveLength(0);
    expect(result.rates).toHaveLength(1);
  });

  it("no reclama nada si todo está en la moneda primaria", async () => {
    const space = await makeSpace("EUR");
    await addAccount(space, "Corriente", "EUR", "100000");

    const result = await listRates(
      forSpace(space.spaceId),
      { primaryCurrency: "EUR", timezone: TIMEZONE },
      {},
    );

    expect(result.missing).toHaveLength(0);
  });

  it("cargar la misma moneda dos veces el mismo día la reemplaza", async () => {
    // Corregir un número mal tecleado es el caso normal.
    await addRate("USD", "EUR", "0.92");
    await addRate("USD", "EUR", "0.95");

    const rows = await testDb.exchangeRate.findMany({
      where: { baseCurrency: "USD", quoteCurrency: "EUR" },
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.rate.toString()).toBe("0.95");
  });

  it("el patrimonio se convierte cuando hay cotización", async () => {
    const space = await makeSpace("EUR");
    await addAccount(space, "Corriente", "EUR", "100000");
    await addAccount(space, "Dólares", "USD", "100000");
    await addRate("USD", "EUR", "0.92");

    const result = await getDashboard(
      forSpace(space.spaceId),
      { primaryCurrency: "EUR", timezone: TIMEZONE },
      TIMEZONE,
      TODAY,
    );

    // 1.000,00 € + 920,00 € = 1.920,00 €
    expect(result.netWorth.converted?.amountMinor).toBe("192000");
    expect(result.netWorth.missingRates).toHaveLength(0);
  });

  it("sin cotización el total viene null y se dice cuál falta", async () => {
    const space = await makeSpace("EUR");
    await addAccount(space, "Corriente", "EUR", "100000");
    await addAccount(space, "Dólares", "USD", "100000");

    const result = await getDashboard(
      forSpace(space.spaceId),
      { primaryCurrency: "EUR", timezone: TIMEZONE },
      TIMEZONE,
      TODAY,
    );

    // Es preferible decir "no puedo convertir esto" a mostrar un número que
    // parece exacto y no lo es.
    expect(result.netWorth.converted).toBeNull();
    expect(result.netWorth.missingRates).toEqual(["USD"]);
  });
});
