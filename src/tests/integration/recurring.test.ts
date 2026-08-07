import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { forSpace } from "@/server/db/scoped";
import { systemClient } from "@/server/db/system";
import { accountBalances } from "@/server/services/balances";
import { createRecurringRule } from "@/server/services/recurring";
import { materializeDueRules } from "@/server/services/recurring/materialize";
import type { CreateRecurringRuleRequest } from "@/shared/contracts/recurring";

import { disconnect, resetDatabase, testDb } from "./helpers/db";

/**
 * Job de materialización contra Postgres real.
 *
 * Lo que se pone a prueba acá es la decisión de fondo del incremento: si el job
 * estuvo caído, **cada ocurrencia vencida se materializa con SU fecha**, no con
 * la de hoy. Un reporte mensual que meta el alquiler de enero en marzo es peor
 * que no tener recurrentes.
 *
 * Y las tres protecciones que la acompañan: el tope por corrida, la
 * idempotencia por unique parcial, y que una regla que falla no arrastre al
 * resto del barrido.
 */

const TIMEZONE = "Europe/Madrid";

interface Space {
  readonly spaceId: string;
  readonly userId: string;
  readonly accountId: string;
  readonly categoryId: string;
}

let counter = 0;

const makeSpace = async (primaryCurrency = "EUR"): Promise<Space> => {
  counter += 1;
  const label = counter.toString().padStart(3, "0");

  const user = await testDb.user.create({
    data: {
      email: `recurring-${label}@monkey.test`,
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

  const db = forSpace(space.id);

  const account = await db.account.create({
    data: {
      spaceId: space.id,
      name: "Banco",
      type: "BANK",
      currency: primaryCurrency,
      initialBalanceMinor: 1_000_000n,
    },
  });

  const category = await db.category.create({
    data: { spaceId: space.id, name: "Vivienda", kind: "EXPENSE" },
  });

  return {
    spaceId: space.id,
    userId: user.id,
    accountId: account.id,
    categoryId: category.id,
  };
};

const addRule = (
  space: Space,
  over: Partial<CreateRecurringRuleRequest> = {},
): Promise<string> =>
  systemClient().$transaction(async (tx) =>
    createRecurringRule(
      forSpace(space.spaceId),
      tx,
      { spaceId: space.spaceId },
      { userId: space.userId, name: "Rodrigo" },
      {
        accountId: space.accountId,
        categoryId: space.categoryId,
        type: "EXPENSE",
        amountMinor: "95000",
        description: "Alquiler",
        frequency: "MONTHLY",
        interval: 1,
        startDate: "2026-01-01",
        byMonthDay: 1,
        autoPost: true,
        isActive: true,
        ...over,
      },
    ),
  );

const materialized = async (
  spaceId: string,
): Promise<{ date: string; status: string; amountMinor: bigint }[]> => {
  const rows = await testDb.transaction.findMany({
    where: { spaceId, recurringRuleId: { not: null }, deletedAt: null },
    orderBy: { date: "asc" },
    select: { date: true, status: true, amountMinor: true },
  });

  return rows.map((row) => ({
    date: row.date.toISOString().slice(0, 10),
    status: row.status,
    amountMinor: row.amountMinor,
  }));
};

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await disconnect();
});

describe("recuperación de atrasos", () => {
  it("materializa TODAS las vencidas, cada una con su fecha", async () => {
    // El job no corrió desde enero. Hoy es 20 de abril.
    const space = await makeSpace();
    await addRule(space);

    const report = await materializeDueRules({
      until: "2026-04-20",
      spaceId: space.spaceId,
    });

    expect(report.transactionsCreated).toBe(4);
    expect(await materialized(space.spaceId)).toEqual([
      { date: "2026-01-01", status: "CLEARED", amountMinor: 95_000n },
      { date: "2026-02-01", status: "CLEARED", amountMinor: 95_000n },
      { date: "2026-03-01", status: "CLEARED", amountMinor: 95_000n },
      { date: "2026-04-01", status: "CLEARED", amountMinor: 95_000n },
    ]);
  });

  it("NINGUNA queda fechada el día de la corrida", async () => {
    // Es la razón de ser de todo lo anterior: si las cuatro cayeran el 20 de
    // abril, el reporte de enero diría cero y el de abril cuadruplicaría.
    const space = await makeSpace();
    await addRule(space);

    await materializeDueRules({ until: "2026-04-20", spaceId: space.spaceId });

    const dates = (await materialized(space.spaceId)).map((row) => row.date);
    expect(dates).not.toContain("2026-04-20");
    expect(new Set(dates).size).toBe(4);
  });

  it("los saldos reflejan las cuatro cuotas", async () => {
    const space = await makeSpace();
    await addRule(space);

    await materializeDueRules({ until: "2026-04-20", spaceId: space.spaceId });

    const balances = await accountBalances(forSpace(space.spaceId));
    // 10.000,00 € de apertura − 4 × 950,00 €
    expect(balances.get(space.accountId)?.balanceMinor).toBe(620_000n);
  });

  it("avanza nextRunDate a la siguiente sin materializar", async () => {
    const space = await makeSpace();
    const ruleId = await addRule(space);

    await materializeDueRules({ until: "2026-04-20", spaceId: space.spaceId });

    const rule = await testDb.recurringRule.findUniqueOrThrow({
      where: { id: ruleId },
      select: { nextRunDate: true, occurrencesCreated: true, lastRunAt: true },
    });

    expect(rule.nextRunDate.toISOString().slice(0, 10)).toBe("2026-05-01");
    expect(rule.occurrencesCreated).toBe(4);
    expect(rule.lastRunAt).not.toBeNull();
  });
});

describe("idempotencia", () => {
  it("dos corridas seguidas no duplican nada", async () => {
    const space = await makeSpace();
    await addRule(space);

    const first = await materializeDueRules({
      until: "2026-04-20",
      spaceId: space.spaceId,
    });
    const second = await materializeDueRules({
      until: "2026-04-20",
      spaceId: space.spaceId,
    });

    expect(first.transactionsCreated).toBe(4);
    expect(second.transactionsCreated).toBe(0);
    expect(await materialized(space.spaceId)).toHaveLength(4);
  });

  it("la base rechaza una segunda ocurrencia en la misma fecha", async () => {
    const space = await makeSpace();
    const ruleId = await addRule(space);

    await materializeDueRules({ until: "2026-01-31", spaceId: space.spaceId });

    // Se fuerza a mano lo que un job mal escrito haría: repetir una fecha.
    await expect(
      forSpace(space.spaceId).transaction.create({
        data: {
          spaceId: space.spaceId,
          accountId: space.accountId,
          categoryId: space.categoryId,
          createdByName: "Rodrigo",
          recurringRuleId: ruleId,
          type: "EXPENSE",
          amountMinor: 95_000n,
          currency: "EUR",
          date: new Date("2026-01-01T00:00:00Z"),
        },
      }),
    ).rejects.toThrow(/Unique constraint failed/);
  });

  it("una corrida que pisa fechas ya creadas las ignora en vez de fallar", async () => {
    const space = await makeSpace();
    const ruleId = await addRule(space);

    await materializeDueRules({ until: "2026-02-28", spaceId: space.spaceId });

    // Se retrocede nextRunDate a mano, como si algo hubiera quedado a medias.
    await testDb.recurringRule.update({
      where: { id: ruleId },
      data: {
        nextRunDate: new Date("2026-01-01T00:00:00Z"),
        occurrencesCreated: 0,
      },
    });

    const report = await materializeDueRules({
      until: "2026-04-20",
      spaceId: space.spaceId,
    });

    expect(report.rulesFailed).toBe(0);
    // Enero y febrero ya estaban: solo se agregan marzo y abril.
    expect(await materialized(space.spaceId)).toHaveLength(4);
  });
});

describe("el tope por corrida", () => {
  it("recorta una regla diaria con meses de atraso, sin saltear nada", async () => {
    const space = await makeSpace();
    const ruleId = await addRule(space, {
      frequency: "DAILY",
      startDate: "2026-01-01",
      byMonthDay: null,
      amountMinor: "1000",
    });

    const first = await materializeDueRules({
      until: "2026-06-30",
      spaceId: space.spaceId,
    });

    // El tope del job es 60.
    expect(first.transactionsCreated).toBe(60);
    expect(first.rulesTruncated).toBe(1);

    const rule = await testDb.recurringRule.findUniqueOrThrow({
      where: { id: ruleId },
      select: { nextRunDate: true },
    });
    // Arranca justo donde cortó: 1 de enero + 60 días.
    expect(rule.nextRunDate.toISOString().slice(0, 10)).toBe("2026-03-02");

    // Y la corrida siguiente continúa donde quedó.
    const second = await materializeDueRules({
      until: "2026-06-30",
      spaceId: space.spaceId,
    });
    expect(second.transactionsCreated).toBe(60);

    const dates = (await materialized(space.spaceId)).map((row) => row.date);
    expect(dates[0]).toBe("2026-01-01");
    // 120 días consecutivos sin huecos: nada se salteó.
    expect(dates).toHaveLength(120);
    expect(new Set(dates).size).toBe(120);
  });
});

describe("fin de la serie", () => {
  it("endDate desactiva la regla cuando se agota", async () => {
    const space = await makeSpace();
    const ruleId = await addRule(space, { endDate: "2026-03-31" });

    await materializeDueRules({ until: "2026-06-30", spaceId: space.spaceId });

    const rule = await testDb.recurringRule.findUniqueOrThrow({
      where: { id: ruleId },
      select: { isActive: true },
    });

    expect(rule.isActive).toBe(false);
    expect(await materialized(space.spaceId)).toHaveLength(3);
  });

  it("maxOccurrences corta aunque haya años de atraso", async () => {
    const space = await makeSpace();
    await addRule(space, { maxOccurrences: 2 });

    const report = await materializeDueRules({
      until: "2029-01-01",
      spaceId: space.spaceId,
    });

    expect(report.transactionsCreated).toBe(2);
    expect(report.rulesCompleted).toBe(1);
  });

  it("una regla pausada no se toca", async () => {
    const space = await makeSpace();
    await addRule(space, { isActive: false });

    const report = await materializeDueRules({
      until: "2026-04-20",
      spaceId: space.spaceId,
    });

    expect(report.rulesExamined).toBe(0);
    expect(await materialized(space.spaceId)).toHaveLength(0);
  });

  it("una regla que todavía no arrancó no genera nada", async () => {
    const space = await makeSpace();
    await addRule(space, { startDate: "2027-01-01" });

    const report = await materializeDueRules({
      until: "2026-04-20",
      spaceId: space.spaceId,
    });

    expect(report.rulesExamined).toBe(0);
    expect(await materialized(space.spaceId)).toHaveLength(0);
  });
});

describe("autoPost", () => {
  it("desactivado, las ocurrencias nacen PENDING", async () => {
    const space = await makeSpace();
    await addRule(space, { autoPost: false });

    await materializeDueRules({ until: "2026-02-28", spaceId: space.spaceId });

    const rows = await materialized(space.spaceId);
    expect(rows.every((row) => row.status === "PENDING")).toBe(true);
  });
});

describe("multi-moneda", () => {
  it("congela la cotización de CADA fecha, no la de hoy", async () => {
    const space = await makeSpace("EUR");

    const { id: usd } = await forSpace(space.spaceId).account.create({
      data: {
        spaceId: space.spaceId,
        name: "Dólares",
        type: "BANK",
        currency: "USD",
        initialBalanceMinor: 0n,
      },
    });

    // Dos cotizaciones distintas: enero y febrero.
    await testDb.exchangeRate.createMany({
      data: [
        {
          baseCurrency: "USD",
          quoteCurrency: "EUR",
          rate: "0.90",
          date: new Date("2026-01-01T00:00:00Z"),
          source: "test",
        },
        {
          baseCurrency: "USD",
          quoteCurrency: "EUR",
          rate: "0.95",
          date: new Date("2026-02-01T00:00:00Z"),
          source: "test",
        },
      ],
    });

    await addRule(space, {
      accountId: usd,
      currency: "USD",
      amountMinor: "10000",
    });

    await materializeDueRules({ until: "2026-02-28", spaceId: space.spaceId });

    const rows = await testDb.transaction.findMany({
      where: { spaceId: space.spaceId, recurringRuleId: { not: null } },
      orderBy: { date: "asc" },
      select: {
        date: true,
        amountPrimaryMinor: true,
        exchangeRateSnapshot: true,
      },
    });

    // 100,00 USD × 0,90 = 90,00 € en enero; × 0,95 = 95,00 € en febrero.
    // Usar la cotización de hoy para las dos habría reescrito la historia.
    expect(rows[0]?.amountPrimaryMinor).toBe(9000n);
    expect(rows[1]?.amountPrimaryMinor).toBe(9500n);
    expect(rows[0]?.exchangeRateSnapshot?.toString()).toBe("0.9");
  });

  it("sin cotización, la regla falla y NO materializa a medias", async () => {
    const space = await makeSpace("EUR");

    const { id: usd } = await forSpace(space.spaceId).account.create({
      data: {
        spaceId: space.spaceId,
        name: "Dólares",
        type: "BANK",
        currency: "USD",
        initialBalanceMinor: 0n,
      },
    });

    await addRule(space, {
      accountId: usd,
      currency: "USD",
      amountMinor: "10000",
    });

    const report = await materializeDueRules({
      until: "2026-04-20",
      spaceId: space.spaceId,
    });

    expect(report.rulesFailed).toBe(1);
    expect(report.transactionsCreated).toBe(0);
    // Inventar un número con la cotización de hoy sería peor que no cargarlo.
    expect(await materialized(space.spaceId)).toHaveLength(0);
  });
});

describe("una regla rota no arrastra al resto", () => {
  it("el barrido sigue con las demás y las cuenta aparte", async () => {
    const space = await makeSpace("EUR");

    const { id: usd } = await forSpace(space.spaceId).account.create({
      data: {
        spaceId: space.spaceId,
        name: "Dólares",
        type: "BANK",
        currency: "USD",
        initialBalanceMinor: 0n,
      },
    });

    // Una sin cotización (falla) y una normal (tiene que salir igual).
    await addRule(space, {
      accountId: usd,
      currency: "USD",
      amountMinor: "10000",
    });
    await addRule(space, { description: "Gimnasio", amountMinor: "5000" });

    const report = await materializeDueRules({
      until: "2026-04-20",
      spaceId: space.spaceId,
    });

    expect(report.rulesExamined).toBe(2);
    expect(report.rulesFailed).toBe(1);
    expect(report.transactionsCreated).toBe(4);
  });
});

describe("aislamiento entre Spaces", () => {
  it("el barrido global procesa todos los Spaces, cada uno en el suyo", async () => {
    const a = await makeSpace();
    const b = await makeSpace();

    await addRule(a);
    await addRule(b, { amountMinor: "30000" });

    const report = await materializeDueRules({ until: "2026-02-28" });

    expect(report.rulesExamined).toBe(2);
    expect(report.transactionsCreated).toBe(4);

    const inA = await materialized(a.spaceId);
    const inB = await materialized(b.spaceId);

    expect(inA).toHaveLength(2);
    expect(inB).toHaveLength(2);
    // Ninguna transacción de A tiene el importe de B ni al revés.
    expect(inA.every((row) => row.amountMinor === 95_000n)).toBe(true);
    expect(inB.every((row) => row.amountMinor === 30_000n)).toBe(true);
  });

  it("acotar el barrido a un Space no toca al otro", async () => {
    const a = await makeSpace();
    const b = await makeSpace();

    await addRule(a);
    await addRule(b);

    await materializeDueRules({ until: "2026-02-28", spaceId: a.spaceId });

    expect(await materialized(a.spaceId)).toHaveLength(2);
    expect(await materialized(b.spaceId)).toHaveLength(0);
  });

  it("las ocurrencias nacen en el Space de su regla", async () => {
    const a = await makeSpace();
    const b = await makeSpace();

    await addRule(a);
    await materializeDueRules({ until: "2026-02-28" });

    // Visto desde el cliente scopeado de B no existe ninguna.
    const fromB = await forSpace(b.spaceId).transaction.findMany({
      where: { recurringRuleId: { not: null } },
      select: { id: true },
    });

    expect(fromB).toHaveLength(0);
  });

  it("una regla borrada lógicamente deja de materializar", async () => {
    const space = await makeSpace();
    const ruleId = await addRule(space);

    await testDb.recurringRule.update({
      where: { id: ruleId },
      data: { deletedAt: new Date() },
    });

    const report = await materializeDueRules({
      until: "2026-04-20",
      spaceId: space.spaceId,
    });

    expect(report.rulesExamined).toBe(0);
  });
});
