import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { forSpace } from "@/server/db/scoped";
import { exportWorkbook } from "@/server/services/import-export/xlsx";

import { disconnect, resetDatabase, testDb } from "./helpers/db";

/**
 * Exportación a Excel contra Postgres real: que el archivo salga, que sea un
 * .xlsx de verdad y que respete el rango y la cuenta pedidos. Los números de
 * cada hoja se prueban en el test unitario del constructor del libro.
 */

const TIMEZONE = "Europe/Madrid";

const setup = async () => {
  const user = await testDb.user.create({
    data: {
      email: "xlsx@monkey.test",
      passwordHash: "hash",
      name: "Rodrigo",
      timezone: TIMEZONE,
      locale: "es-ES",
      emailVerifiedAt: new Date(),
    },
  });
  const space = await testDb.space.create({
    data: {
      name: "Casa Compartida",
      primaryCurrency: "EUR",
      timezone: TIMEZONE,
      memberships: { create: { userId: user.id, role: "OWNER" } },
    },
  });
  const db = forSpace(space.id);
  const bank = await db.account.create({
    data: {
      spaceId: space.id,
      name: "Banco",
      type: "BANK",
      currency: "EUR",
      initialBalanceMinor: 0n,
    },
  });
  const cash = await db.account.create({
    data: {
      spaceId: space.id,
      name: "Efectivo",
      type: "CASH",
      currency: "EUR",
      initialBalanceMinor: 0n,
    },
  });

  const tx = (accountId: string, date: string, amountMinor: bigint) =>
    db.transaction.create({
      data: {
        spaceId: space.id,
        accountId,
        createdByUserId: user.id,
        createdByName: "Rodrigo",
        type: "EXPENSE",
        amountMinor,
        currency: "EUR",
        date: new Date(`${date}T00:00:00Z`),
      },
    });

  await tx(bank.id, "2026-09-10", 1_000n);
  await tx(bank.id, "2026-10-05", 2_000n);
  await tx(cash.id, "2026-10-06", 3_000n);

  return { space, bank, cash, db };
};

const run = (
  fixture: Awaited<ReturnType<typeof setup>>,
  query: Parameters<typeof exportWorkbook>[1]["query"],
) =>
  exportWorkbook(fixture.db, {
    space: {
      spaceId: fixture.space.id,
      name: fixture.space.name,
      primaryCurrency: "EUR",
    },
    locale: "es-ES",
    timezone: TIMEZONE,
    weekStartsOn: 1,
    query,
  });

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await disconnect();
});

describe("exportación a Excel", () => {
  it("produce un .xlsx con las hojas esperadas", async () => {
    const fixture = await setup();
    const result = await run(fixture, { format: "xlsx" });

    // Un .xlsx es un zip: arranca con la firma "PK" y lista sus partes por
    // nombre sin comprimir, así que los nombres de hoja se pueden buscar.
    expect(result.buffer.subarray(0, 2).toString("latin1")).toBe("PK");
    const zipText = result.buffer.toString("latin1");
    expect(zipText).toContain("xl/worksheets/sheet1.xml");
    expect(zipText).toContain("xl/worksheets/sheet3.xml");
    expect(result.rowCount).toBe(3);
    expect(result.filename).toBe("monkey-casa-compartida-todo.xlsx");
  });

  it("respeta el rango y lo pone en el nombre", async () => {
    const fixture = await setup();
    const result = await run(fixture, {
      format: "xlsx",
      from: "2026-10-01",
      to: "2026-10-31",
    });

    expect(result.rowCount).toBe(2);
    expect(result.filename).toBe(
      "monkey-casa-compartida-2026-10-01_2026-10-31.xlsx",
    );
  });

  it("respeta la cuenta y la pone en el nombre", async () => {
    const fixture = await setup();
    const result = await run(fixture, {
      format: "xlsx",
      accountId: fixture.cash.id,
    });

    expect(result.rowCount).toBe(1);
    expect(result.filename).toBe("monkey-casa-compartida-efectivo-todo.xlsx");
  });

  it("sin movimientos igual produce un libro válido", async () => {
    const fixture = await setup();
    const result = await run(fixture, {
      format: "xlsx",
      from: "2020-01-01",
      to: "2020-01-31",
    });

    expect(result.rowCount).toBe(0);
    expect(result.buffer.subarray(0, 2).toString("latin1")).toBe("PK");
  });
});
