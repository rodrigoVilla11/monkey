import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { forSpace } from "@/server/db/scoped";
import { systemClient } from "@/server/db/system";
import { exportTransactions } from "@/server/services/import-export/export";
import { importTransactions } from "@/server/services/import-export/import";
import type { ImportRequest } from "@/shared/contracts/import-export";
import { parseCsv } from "@/shared/csv";

import { disconnect, resetDatabase, testDb } from "./helpers/db";

/**
 * Importación y exportación de CSV contra Postgres real.
 *
 * Los dos tests que más importan de este archivo:
 *
 *  · **`dryRun` no miente.** Recorre el mismo camino que la importación real y
 *    no escribe nada. Si la previsualización dice 47, entran 47.
 *  · **La ida y vuelta es exacta.** Exportar e importar el mismo archivo no
 *    duplica ni un movimiento, que es la razón por la que la exportación lleva
 *    el ID interno.
 */

const TIMEZONE = "Europe/Madrid";

interface Space {
  readonly spaceId: string;
  readonly userId: string;
  readonly accountId: string;
  readonly otherAccountId: string;
  readonly categoryId: string;
}

let counter = 0;

const makeSpace = async (): Promise<Space> => {
  counter += 1;
  const label = counter.toString().padStart(3, "0");

  const user = await testDb.user.create({
    data: {
      email: `csv-${label}@monkey.test`,
      passwordHash: "hash",
      name: "Rodrigo",
      timezone: TIMEZONE,
      locale: "es-ES",
      emailVerifiedAt: new Date(),
    },
  });

  const space = await testDb.space.create({
    data: {
      name: `Casa ${label}`,
      primaryCurrency: "EUR",
      timezone: TIMEZONE,
      memberships: { create: { userId: user.id, role: "OWNER" } },
    },
  });

  const db = forSpace(space.id);

  const account = await db.account.create({
    data: {
      spaceId: space.id,
      name: "Corriente",
      type: "BANK",
      currency: "EUR",
      initialBalanceMinor: 1_000_000n,
    },
  });

  const other = await db.account.create({
    data: {
      spaceId: space.id,
      name: "Ahorro",
      type: "BANK",
      currency: "EUR",
      initialBalanceMinor: 0n,
    },
  });

  const category = await db.category.create({
    data: { spaceId: space.id, name: "Alimentación", kind: "EXPENSE" },
  });

  return {
    spaceId: space.id,
    userId: user.id,
    accountId: account.id,
    otherAccountId: other.id,
    categoryId: category.id,
  };
};

const runImport = (
  space: Space,
  input: Partial<ImportRequest> & { content: string },
) =>
  systemClient().$transaction(async (tx) =>
    importTransactions(
      forSpace(space.spaceId),
      tx,
      {
        spaceId: space.spaceId,
        primaryCurrency: "EUR",
        timezone: TIMEZONE,
      },
      { userId: space.userId, name: "Rodrigo" },
      { dryRun: false, ...input },
    ),
  );

const countTransactions = (spaceId: string): Promise<number> =>
  testDb.transaction.count({ where: { spaceId, deletedAt: null } });

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await disconnect();
});

describe("la previsualización no miente", () => {
  const content = [
    "fecha;importe;descripcion;cuenta",
    "2026-08-01;-84,50;Supermercado;Corriente",
    "2026-08-02;1850,00;Nómina;Corriente",
    "2026-08-03;-12,50;Café;Corriente",
  ].join("\n");

  it("dryRun no escribe nada", async () => {
    const space = await makeSpace();

    const report = await runImport(space, { content, dryRun: true });

    expect(report.dryRun).toBe(true);
    expect(report.created).toBe(3);
    // Y sin embargo la base sigue vacía.
    expect(await countTransactions(space.spaceId)).toBe(0);
  });

  it("lo que anuncia la previsualización es lo que entra", async () => {
    const space = await makeSpace();

    const preview = await runImport(space, { content, dryRun: true });
    const applied = await runImport(space, { content, dryRun: false });

    expect(applied.created).toBe(preview.created);
    expect(applied.failed).toBe(preview.failed);
    expect(applied.issues.length).toBe(preview.issues.length);
    expect(await countTransactions(space.spaceId)).toBe(preview.created);
  });
});

describe("formatos que produce la gente", () => {
  it("lee un extracto español: punto y coma, coma decimal y BOM", async () => {
    const space = await makeSpace();

    const content =
      "﻿Fecha;Concepto;Importe\r\n" +
      '2026-08-01;"Supermercado, compra semanal";-84,50\r\n' +
      "2026-08-02;Nómina;1.850,00\r\n";

    const report = await runImport(space, {
      content,
      defaultAccountId: space.accountId,
    });

    expect(report.delimiter).toBe(";");
    expect(report.created).toBe(2);

    const rows = await testDb.transaction.findMany({
      where: { spaceId: space.spaceId },
      orderBy: { date: "asc" },
      select: { type: true, amountMinor: true, description: true },
    });

    // El signo decide el tipo cuando no hay columna de tipo: es lo que hace
    // todo banco.
    expect(rows[0]).toEqual({
      type: "EXPENSE",
      amountMinor: 8450n,
      description: "Supermercado, compra semanal",
    });
    expect(rows[1]).toEqual({
      type: "INCOME",
      amountMinor: 185_000n,
      description: "Nómina",
    });
  });

  it("acepta fechas dd/mm/aaaa", async () => {
    const space = await makeSpace();

    const report = await runImport(space, {
      content: "fecha,importe\n01/08/2026,-10.00\n15/12/26,-20.00",
      defaultAccountId: space.accountId,
    });

    expect(report.created).toBe(2);

    const dates = (
      await testDb.transaction.findMany({
        where: { spaceId: space.spaceId },
        orderBy: { date: "asc" },
        select: { date: true },
      })
    ).map((row) => row.date.toISOString().slice(0, 10));

    expect(dates).toEqual(["2026-08-01", "2026-12-15"]);
  });

  it("reconoce las columnas con tildes y en mayúsculas", async () => {
    const space = await makeSpace();

    const report = await runImport(space, {
      content: "FECHA,IMPORTE,DESCRIPCIÓN\n2026-08-01,-10.00,Prueba",
      defaultAccountId: space.accountId,
    });

    expect(report.created).toBe(1);
  });

  it("exige al menos fecha e importe", async () => {
    const space = await makeSpace();

    await expect(
      runImport(space, { content: "concepto,cuenta\nCafé,Corriente" }),
    ).rejects.toThrow(/fecha y una de importe/);
  });
});

describe("la plata entra aunque falte la etiqueta", () => {
  it("una categoría desconocida es un aviso, no un error", async () => {
    const space = await makeSpace();

    const report = await runImport(space, {
      content:
        "fecha,importe,categoria,cuenta\n2026-08-01,-10.00,Inexistente,Corriente",
      defaultAccountId: space.accountId,
    });

    expect(report.created).toBe(1);
    expect(report.failed).toBe(0);
    expect(report.issues[0]?.status).toBe("warning");
    expect(report.issues[0]?.message).toMatch(/No existe la categoría/);

    const row = await testDb.transaction.findFirstOrThrow({
      where: { spaceId: space.spaceId },
      select: { categoryId: true },
    });
    expect(row.categoryId).toBeNull();
  });

  it("con createMissingCategories la crea", async () => {
    const space = await makeSpace();

    const report = await runImport(space, {
      content:
        "fecha,importe,categoria,cuenta\n2026-08-01,-10.00,Ocio,Corriente",
      defaultAccountId: space.accountId,
      createMissingCategories: true,
    });

    expect(report.newCategories).toEqual(["Ocio"]);

    const row = await testDb.transaction.findFirstOrThrow({
      where: { spaceId: space.spaceId },
      select: { category: { select: { name: true, kind: true } } },
    });
    expect(row.category?.name).toBe("Ocio");
    expect(row.category?.kind).toBe("EXPENSE");
  });

  it("no mete un gasto en una categoría de ingresos", async () => {
    const space = await makeSpace();

    await forSpace(space.spaceId).category.create({
      data: { spaceId: space.spaceId, name: "Sueldo", kind: "INCOME" },
    });

    const report = await runImport(space, {
      content:
        "fecha,importe,categoria,cuenta\n2026-08-01,-10.00,Sueldo,Corriente",
      defaultAccountId: space.accountId,
    });

    // Entra igual —la plata se movió— pero sin la categoría equivocada.
    expect(report.created).toBe(1);
    expect(report.issues[0]?.status).toBe("warning");
    expect(report.issues[0]?.message).toMatch(/categoría de ingresos/);
  });

  it("una fecha o un importe ilegibles sí son errores", async () => {
    const space = await makeSpace();

    const report = await runImport(space, {
      content: [
        "fecha,importe,cuenta",
        "no-es-fecha,-10.00,Corriente",
        "2026-08-01,no-es-importe,Corriente",
        "2026-08-02,0,Corriente",
        "2026-08-03,-10.00,Corriente",
      ].join("\n"),
      defaultAccountId: space.accountId,
    });

    expect(report.created).toBe(1);
    expect(report.failed).toBe(3);
    expect(report.issues.map((i) => i.line)).toEqual([2, 3, 4]);
  });

  it("una cuenta desconocida es un error: sin cuenta no hay movimiento", async () => {
    const space = await makeSpace();

    const report = await runImport(space, {
      content: "fecha,importe,cuenta\n2026-08-01,-10.00,Inexistente",
    });

    expect(report.created).toBe(0);
    expect(report.failed).toBe(1);
    expect(report.issues[0]?.message).toMatch(/No existe la cuenta/);
  });
});

describe("duplicados", () => {
  const content = "fecha,importe,cuenta\n2026-08-01,-10.00,Corriente";

  it("no importa dos veces el mismo archivo", async () => {
    const space = await makeSpace();

    await runImport(space, { content });
    const second = await runImport(space, { content });

    expect(second.created).toBe(0);
    expect(second.skipped).toBe(1);
    expect(await countTransactions(space.spaceId)).toBe(1);
  });

  it("lo avisa fila por fila en vez de descartar en silencio", async () => {
    const space = await makeSpace();

    await runImport(space, { content });
    const second = await runImport(space, { content });

    expect(second.issues[0]?.status).toBe("duplicate");
    expect(second.issues[0]?.line).toBe(2);
  });

  it("con onDuplicate import entra igual", async () => {
    const space = await makeSpace();

    await runImport(space, { content });
    const second = await runImport(space, { content, onDuplicate: "import" });

    expect(second.created).toBe(1);
    expect(await countTransactions(space.spaceId)).toBe(2);
  });
});

describe("ida y vuelta", () => {
  const seed = async (space: Space): Promise<void> => {
    const db = forSpace(space.spaceId);

    await db.transaction.create({
      data: {
        spaceId: space.spaceId,
        accountId: space.accountId,
        categoryId: space.categoryId,
        createdByUserId: space.userId,
        createdByName: "Rodrigo",
        type: "EXPENSE",
        amountMinor: 8450n,
        currency: "EUR",
        date: new Date("2026-08-01T00:00:00Z"),
        description: 'Supermercado, "el grande"',
      },
    });

    await db.transaction.create({
      data: {
        spaceId: space.spaceId,
        accountId: space.accountId,
        createdByUserId: space.userId,
        createdByName: "Rodrigo",
        type: "INCOME",
        amountMinor: 185_000n,
        currency: "EUR",
        date: new Date("2026-08-02T00:00:00Z"),
        description: "Nómina",
      },
    });
  };

  it("exporta con cabecera, BOM y punto y coma para un locale español", async () => {
    const space = await makeSpace();
    await seed(space);

    const result = await exportTransactions(forSpace(space.spaceId), {
      locale: "es-ES",
      spaceName: "Casa",
      query: {},
    });

    expect(result.csv.startsWith("﻿")).toBe(true);
    expect(result.rowCount).toBe(2);
    expect(result.filename).toMatch(/^monkey-casa\.csv$/);

    const rows = parseCsv(result.csv, ";");
    expect(rows[0]?.[0]).toBe("id");
    // El importe lleva signo y coma decimal: es lo que abre Excel en español.
    expect(rows[1]?.[3]).toBe("-84,50");
    expect(rows[2]?.[3]).toBe("1850,00");
  });

  it("reimportar lo exportado NO duplica nada", async () => {
    const space = await makeSpace();
    await seed(space);

    const exported = await exportTransactions(forSpace(space.spaceId), {
      locale: "es-ES",
      spaceName: "Casa",
      query: {},
    });

    const report = await runImport(space, { content: exported.csv });

    // Es la razón por la que la exportación lleva el ID interno.
    expect(report.created).toBe(0);
    expect(report.skipped).toBe(2);
    expect(await countTransactions(space.spaceId)).toBe(2);
  });

  it("un ID de otra instalación no coincide y cae en la heurística", async () => {
    const space = await makeSpace();

    const report = await runImport(space, {
      content:
        "id,fecha,importe,cuenta\nid-de-otra-app,2026-08-01,-10.00,Corriente",
    });

    // No coincide con ningún ID de este Space, así que entra normalmente.
    expect(report.created).toBe(1);
  });

  it("conserva descripciones con comas y comillas", async () => {
    const space = await makeSpace();
    await seed(space);

    const exported = await exportTransactions(forSpace(space.spaceId), {
      locale: "es-ES",
      spaceName: "Casa",
      query: {},
    });

    const rows = parseCsv(exported.csv, ";");
    expect(rows[1]?.[7]).toBe('Supermercado, "el grande"');
  });
});

describe("transferencias", () => {
  it("se rearman por pares y pasan por createTransfer", async () => {
    const space = await makeSpace();

    const content = [
      "fecha;importe;cuenta;tipo;grupo_transferencia;sentido_transferencia",
      "2026-08-01;-250,00;Corriente;Transferencia;g1;Salida",
      "2026-08-01;250,00;Ahorro;Transferencia;g1;Entrada",
    ].join("\n");

    const report = await runImport(space, { content });

    expect(report.created).toBe(2);

    const legs = await testDb.transaction.findMany({
      where: { spaceId: space.spaceId, type: "TRANSFER" },
      select: { transferDirection: true, amountMinor: true, accountId: true },
    });

    expect(legs).toHaveLength(2);
    // Las dos patas comparten grupo y sentidos opuestos: la invariante del
    // incremento 11 sigue en pie porque se creó con su propio service.
    expect(new Set(legs.map((leg) => leg.transferDirection))).toEqual(
      new Set(["OUT", "IN"]),
    );
  });

  it("una pata suelta es un error, no medio movimiento", async () => {
    const space = await makeSpace();

    const content = [
      "fecha;importe;cuenta;tipo;grupo_transferencia;sentido_transferencia",
      "2026-08-01;-250,00;Corriente;Transferencia;g1;Salida",
    ].join("\n");

    const report = await runImport(space, { content });

    expect(report.created).toBe(0);
    expect(report.failed).toBe(1);
    expect(report.issues[0]?.message).toMatch(/Falta la otra pata/);
    expect(await countTransactions(space.spaceId)).toBe(0);
  });

  it("una transferencia sin grupo tampoco entra", async () => {
    const space = await makeSpace();

    const report = await runImport(space, {
      content:
        "fecha;importe;cuenta;tipo\n2026-08-01;-250,00;Corriente;Transferencia",
    });

    expect(report.failed).toBe(1);
    expect(report.issues[0]?.message).toMatch(/columna de grupo/);
  });
});

describe("todo o nada", () => {
  it("un fallo a mitad no deja media importación", async () => {
    const space = await makeSpace();

    // La cuenta por defecto no existe: el service tira antes de escribir.
    await expect(
      runImport(space, {
        content: "fecha,importe\n2026-08-01,-10.00\n2026-08-02,-20.00",
        defaultAccountId: "cuenta-que-no-existe",
      }),
    ).rejects.toThrow(/No se encontró la cuenta/);

    expect(await countTransactions(space.spaceId)).toBe(0);
  });
});

describe("aislamiento entre Spaces", () => {
  it("la exportación solo trae lo del Space que pregunta", async () => {
    const mine = await makeSpace();
    const other = await makeSpace();

    await forSpace(other.spaceId).transaction.create({
      data: {
        spaceId: other.spaceId,
        accountId: other.accountId,
        createdByName: "Ajeno",
        type: "EXPENSE",
        amountMinor: 99_999n,
        currency: "EUR",
        date: new Date("2026-08-01T00:00:00Z"),
        description: "Gasto ajeno",
      },
    });

    const result = await exportTransactions(forSpace(mine.spaceId), {
      locale: "es-ES",
      spaceName: "Casa",
      query: {},
    });

    expect(result.rowCount).toBe(0);
    expect(result.csv).not.toContain("Gasto ajeno");
  });

  it("no se puede importar a la cuenta de otro Space", async () => {
    const mine = await makeSpace();
    const other = await makeSpace();

    await expect(
      runImport(mine, {
        content: "fecha,importe\n2026-08-01,-10.00",
        defaultAccountId: other.accountId,
      }),
    ).rejects.toThrow(/No se encontró la cuenta/);
  });

  it("una cuenta del otro Space por nombre tampoco resuelve", async () => {
    const mine = await makeSpace();
    await makeSpace();

    // Las dos se llaman "Corriente", pero solo se busca entre las propias.
    const report = await runImport(mine, {
      content: "fecha,importe,cuenta\n2026-08-01,-10.00,Corriente",
    });

    const row = await testDb.transaction.findFirstOrThrow({
      where: { spaceId: mine.spaceId },
      select: { accountId: true },
    });

    expect(report.created).toBe(1);
    expect(row.accountId).toBe(mine.accountId);
  });
});
