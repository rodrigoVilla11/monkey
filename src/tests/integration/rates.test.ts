import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { ApiError } from "@/server/api/errors";
import { forSpace } from "@/server/db/scoped";
import { systemClient } from "@/server/db/system";
import { lookupRate } from "@/server/services/rates/manage";
import { createTransfer, getTransfer } from "@/server/services/transfers";

import { disconnect, resetDatabase, testDb } from "./helpers/db";

/**
 * Cotizaciones contra Postgres real: la búsqueda que ve el cliente y su uso
 * para el cambio de moneda automático en las transferencias.
 *
 * Lo que importa acá: que la búsqueda resuelva el par inverso y la última
 * fecha hasta la pedida —es lo que hace que "cargar EUR→ARS" alcance para
 * transferir en los dos sentidos cualquier día—, y que una transferencia sin
 * importe de destino use exactamente esa cotización.
 */

const TIMEZONE = "Europe/Madrid";
const DATE = "2026-08-15";

interface Space {
  readonly spaceId: string;
  readonly userId: string;
  readonly primaryCurrency: string;
}

let counter = 0;
const suffix = (): string => {
  counter += 1;
  return counter.toString().padStart(3, "0");
};

const makeSpace = async (primaryCurrency: string): Promise<Space> => {
  const label = suffix();
  const user = await testDb.user.create({
    data: {
      email: `rates-${label}@monkey.test`,
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
): Promise<string> => {
  const account = await forSpace(spaceId).account.create({
    data: {
      spaceId,
      name,
      type: "BANK",
      currency,
      initialBalanceMinor: 1_000_000n,
    },
  });
  return account.id;
};

const loadRate = (
  base: string,
  quote: string,
  rate: string,
  date: string,
): Promise<unknown> =>
  testDb.exchangeRate.create({
    data: {
      baseCurrency: base,
      quoteCurrency: quote,
      rate,
      date: new Date(`${date}T00:00:00Z`),
      source: "manual",
    },
  });

const transfer = async (
  space: Space,
  input: Parameters<typeof createTransfer>[4],
) => {
  const id = await systemClient().$transaction(async (tx) =>
    createTransfer(
      forSpace(space.spaceId),
      tx,
      { spaceId: space.spaceId, primaryCurrency: space.primaryCurrency },
      { userId: space.userId, name: "Rodrigo", timezone: TIMEZONE },
      input,
    ),
  );
  return getTransfer(forSpace(space.spaceId), space.primaryCurrency, id);
};

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await disconnect();
});

describe("búsqueda de cotización", () => {
  it("devuelve la cargada para el par y la fecha", async () => {
    await loadRate("EUR", "ARS", "1150.5", DATE);

    const found = await lookupRate(TIMEZONE, {
      baseCurrency: "EUR",
      quoteCurrency: "ARS",
      date: DATE,
    });

    expect(found).toEqual({
      baseCurrency: "EUR",
      quoteCurrency: "ARS",
      rate: "1150.5",
      date: DATE,
      source: "manual",
    });
  });

  it("usa la última anterior a la fecha pedida (fin de semana, feriado)", async () => {
    await loadRate("EUR", "ARS", "1100", "2026-08-10");
    await loadRate("EUR", "ARS", "1150.5", "2026-08-14");
    await loadRate("EUR", "ARS", "1200", "2026-08-20");

    const found = await lookupRate(TIMEZONE, {
      baseCurrency: "EUR",
      quoteCurrency: "ARS",
      date: "2026-08-16",
    });

    expect(found?.rate).toBe("1150.5");
    expect(found?.date).toBe("2026-08-14");
  });

  it("resuelve el par inverso invirtiendo", async () => {
    // Cargar EUR→ARS alcanza para preguntar ARS→EUR.
    await loadRate("EUR", "ARS", "1000", DATE);

    const found = await lookupRate(TIMEZONE, {
      baseCurrency: "ARS",
      quoteCurrency: "EUR",
      date: DATE,
    });

    expect(found?.rate).toBe("0.001");
    expect(found?.source).toBe("manual:inverso");
  });

  it("null si no hay nada cargado", async () => {
    const found = await lookupRate(TIMEZONE, {
      baseCurrency: "EUR",
      quoteCurrency: "ARS",
      date: DATE,
    });

    expect(found).toBeNull();
  });
});

describe("cambio de moneda automático en transferencias", () => {
  it("sin importe de destino, convierte con la cotización del día", async () => {
    const space = await makeSpace("EUR");
    const euros = await makeAccount(space.spaceId, "Banco", "EUR");
    const pesos = await makeAccount(space.spaceId, "Pesos", "ARS");
    await loadRate("EUR", "ARS", "1150.5", DATE);

    const result = await transfer(space, {
      fromAccountId: euros,
      toAccountId: pesos,
      amountOutMinor: "50000", // 500,00 €
      date: DATE,
    });

    // 500 × 1150,5 = 575.250,00 ARS
    expect(result.amountIn.amountMinor).toBe("57525000");
    expect(result.amountIn.currency).toBe("ARS");
    expect(result.rate).toBe("1150.5");
    // La transferencia sigue siendo neutra para el patrimonio.
    expect(result.amountPrimary.amountMinor).toBe("50000");
  });

  it("también convierte en el sentido inverso con la misma cotización", async () => {
    const space = await makeSpace("EUR");
    const euros = await makeAccount(space.spaceId, "Banco", "EUR");
    const pesos = await makeAccount(space.spaceId, "Pesos", "ARS");
    await loadRate("EUR", "ARS", "1000", DATE);

    const result = await transfer(space, {
      fromAccountId: pesos,
      toAccountId: euros,
      amountOutMinor: "50000000", // 500.000,00 ARS
      date: DATE,
    });

    expect(result.amountIn.amountMinor).toBe("50000"); // 500,00 €
  });

  it("lo que diga el usuario manda sobre la cotización cargada", async () => {
    // El banco aplicó otra cotización: el importe real es el que vale.
    const space = await makeSpace("EUR");
    const euros = await makeAccount(space.spaceId, "Banco", "EUR");
    const pesos = await makeAccount(space.spaceId, "Pesos", "ARS");
    await loadRate("EUR", "ARS", "1150.5", DATE);

    const result = await transfer(space, {
      fromAccountId: euros,
      toAccountId: pesos,
      amountOutMinor: "50000",
      amountInMinor: "56000000", // 560.000 ARS: comisión incluida
      date: DATE,
    });

    expect(result.amountIn.amountMinor).toBe("56000000");
    expect(result.rate).toBe("1120");
  });

  it("sin cotización ni importe de destino, explica qué falta", async () => {
    const space = await makeSpace("EUR");
    const euros = await makeAccount(space.spaceId, "Banco", "EUR");
    const pesos = await makeAccount(space.spaceId, "Pesos", "ARS");

    const attempt = () =>
      transfer(space, {
        fromAccountId: euros,
        toAccountId: pesos,
        amountOutMinor: "50000",
        date: DATE,
      });

    await expect(attempt()).rejects.toThrow(ApiError);
    await expect(attempt()).rejects.toThrow(/EUR → ARS/);
  });

  it("entre cuentas de la misma moneda no consulta nada", async () => {
    const space = await makeSpace("EUR");
    const a = await makeAccount(space.spaceId, "Banco", "EUR");
    const b = await makeAccount(space.spaceId, "Efectivo", "EUR");

    const result = await transfer(space, {
      fromAccountId: a,
      toAccountId: b,
      amountOutMinor: "12345",
      date: DATE,
    });

    expect(result.amountIn.amountMinor).toBe("12345");
    expect(result.rate).toBeNull();
  });
});
