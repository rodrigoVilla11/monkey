import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { forSpace, forSpaceWithDeleted } from "@/server/db/scoped";
import { SpaceScopeError } from "@/server/db/space-scope";

import {
  createSpaceFixture,
  disconnect,
  resetDatabase,
  testDb,
  type SpaceFixture,
} from "./helpers/db";

/**
 * Aislamiento entre Spaces a nivel de capa de datos.
 *
 * Se montan DOS Spaces completos y se comprueba que un cliente scopeado al
 * Space A no pueda ver ni tocar nada del Space B — ni siquiera pasándole IDs
 * válidos del otro Space, que es exactamente el ataque que importa.
 *
 * Esta es la primera de las dos capas del test que pide el brief. La segunda,
 * la misma prueba pero contra cada endpoint HTTP, llega en el incremento 6.
 */

let a: SpaceFixture;
let b: SpaceFixture;

beforeAll(async () => {
  await resetDatabase();
  a = await createSpaceFixture("A");
  b = await createSpaceFixture("B");
});

afterAll(async () => {
  await resetDatabase();
  await disconnect();
});

describe("lecturas", () => {
  it("findMany solo devuelve filas del Space", async () => {
    const rows = await forSpace(a.spaceId).transaction.findMany();

    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(a.transactionId);
    expect(rows.every((r) => r.spaceId === a.spaceId)).toBe(true);
  });

  it("findFirst con un ID del otro Space no devuelve nada", async () => {
    const row = await forSpace(a.spaceId).transaction.findFirst({
      where: { id: b.transactionId },
    });

    expect(row).toBeNull();
  });

  it("findUnique con un ID del otro Space no devuelve nada", async () => {
    // El caso delicado: `where` de findUnique exige un campo único, así que el
    // spaceId se MEZCLA en el nivel superior en vez de envolverse en AND.
    // Este test comprueba que Prisma aplique de verdad ese filtro extra.
    const row = await forSpace(a.spaceId).transaction.findUnique({
      where: { id: b.transactionId },
    });

    expect(row).toBeNull();
  });

  it("findUniqueOrThrow con un ID ajeno tira, no devuelve la fila", async () => {
    await expect(
      forSpace(a.spaceId).transaction.findUniqueOrThrow({
        where: { id: b.transactionId },
      }),
    ).rejects.toThrow();
  });

  it("un where con OR no puede escapar del scope", async () => {
    // Envolver en AND (y no mezclar) es lo que hace que esto siga acotado.
    const rows = await forSpace(a.spaceId).transaction.findMany({
      where: {
        OR: [{ id: a.transactionId }, { id: b.transactionId }],
      },
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(a.transactionId);
  });

  it("pasar el spaceId del otro Space a mano no sirve de nada", async () => {
    const rows = await forSpace(a.spaceId).transaction.findMany({
      where: { spaceId: b.spaceId },
    });

    // El guard va primero en el AND: pide spaceId = A Y spaceId = B. Vacío.
    expect(rows).toHaveLength(0);
  });

  it("count, aggregate y groupBy también quedan acotados", async () => {
    const db = forSpace(a.spaceId);

    expect(await db.transaction.count()).toBe(1);

    const aggregate = await db.transaction.aggregate({
      _sum: { amountMinor: true },
    });
    expect(aggregate._sum.amountMinor).toBe(2500n);

    const grouped = await db.transaction.groupBy({
      by: ["spaceId"],
      _count: true,
    });
    expect(grouped).toHaveLength(1);
    expect(grouped[0]?.spaceId).toBe(a.spaceId);
  });

  it("cuentas y categorías del otro Space son invisibles", async () => {
    const db = forSpace(a.spaceId);

    expect(await db.account.findMany()).toHaveLength(1);
    expect(await db.category.findMany()).toHaveLength(1);
    expect(
      await db.account.findFirst({ where: { id: b.accountId } }),
    ).toBeNull();
  });
});

describe("escrituras", () => {
  it("create pisa un spaceId ajeno metido en el payload", async () => {
    // El ataque que importa: colar el spaceId de otro en el body. El tipo lo
    // admite (es un string válido), así que la única defensa es la extensión.
    const created = await forSpace(a.spaceId).tag.create({
      data: { name: "intento-de-inyeccion", spaceId: b.spaceId },
    });

    expect(created.spaceId).toBe(a.spaceId);
  });

  it("create funciona aunque el spaceId no venga en el payload", async () => {
    // Los tipos de Prisma exigen spaceId (ver la nota en scoped.ts), pero la
    // extensión lo inyecta igual. El cast simula a alguien que esquiva los
    // tipos: ni así se escribe en el Space equivocado.
    const created = await forSpace(a.spaceId).tag.create({
      data: { name: "creado-sin-spaceid" } as unknown as {
        name: string;
        spaceId: string;
      },
    });

    expect(created.spaceId).toBe(a.spaceId);
  });

  it("createMany pisa el spaceId en cada fila", async () => {
    const db = forSpace(a.spaceId);
    await db.tag.createMany({
      data: [
        { name: "lote-1", spaceId: a.spaceId },
        { name: "lote-2", spaceId: b.spaceId },
      ],
    });

    const rows = await db.tag.findMany({
      where: { name: { startsWith: "lote-" } },
    });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.spaceId === a.spaceId)).toBe(true);
  });

  it("update sobre una fila del otro Space no encuentra nada", async () => {
    await expect(
      forSpace(a.spaceId).transaction.update({
        where: { id: b.transactionId },
        data: { description: "modificada por A" },
      }),
    ).rejects.toThrow();

    const untouched = await testDb.transaction.findUnique({
      where: { id: b.transactionId },
    });
    expect(untouched?.description).toBe("Gasto de B");
  });

  it("updateMany no toca las filas del otro Space", async () => {
    const result = await forSpace(a.spaceId).transaction.updateMany({
      data: { description: "actualizado en masa" },
    });

    expect(result.count).toBe(1);

    const other = await testDb.transaction.findUnique({
      where: { id: b.transactionId },
    });
    expect(other?.description).toBe("Gasto de B");
  });

  it("no se puede mover una fila de Space con un update", async () => {
    await expect(
      forSpace(a.spaceId).transaction.update({
        where: { id: a.transactionId },
        data: { spaceId: b.spaceId },
      }),
    ).rejects.toThrow(SpaceScopeError);
  });

  it("delete sobre una fila del otro Space no encuentra nada", async () => {
    await expect(
      forSpace(a.spaceId).tag.delete({ where: { id: "no-existe" } }),
    ).rejects.toThrow();

    const bTag = await testDb.tag.create({
      data: { spaceId: b.spaceId, name: "tag-de-b" },
    });

    await expect(
      forSpace(a.spaceId).tag.delete({ where: { id: bTag.id } }),
    ).rejects.toThrow();

    expect(
      await testDb.tag.findUnique({ where: { id: bTag.id } }),
    ).not.toBeNull();
  });

  it("deleteMany solo borra dentro del Space", async () => {
    const db = forSpace(a.spaceId);
    await db.tag.createMany({
      data: [{ name: "borrable", spaceId: a.spaceId }],
    });

    const before = await testDb.tag.count();
    const result = await db.tag.deleteMany({ where: { name: "borrable" } });

    expect(result.count).toBe(1);
    expect(await testDb.tag.count()).toBe(before - 1);
    // El tag de B sigue ahí.
    expect(
      await testDb.tag.count({ where: { spaceId: b.spaceId } }),
    ).toBeGreaterThan(0);
  });
});

describe("integridad referencial entre Spaces", () => {
  it("no se puede crear una transacción que apunte a una cuenta ajena", async () => {
    // La extensión pone spaceId = A, pero el accountId sale del payload.
    // Lo que corta esto es la clave foránea compuesta (spaceId, accountId).
    await expect(
      forSpace(a.spaceId).transaction.create({
        data: {
          spaceId: a.spaceId,
          accountId: b.accountId,
          createdByName: "atacante",
          type: "EXPENSE",
          amountMinor: 999n,
          currency: "EUR",
          date: new Date("2026-08-05T00:00:00Z"),
        },
      }),
    ).rejects.toThrow();
  });

  it("no se puede reasignar una transacción a una categoría ajena", async () => {
    await expect(
      forSpace(a.spaceId).transaction.update({
        where: { id: a.transactionId },
        data: { categoryId: b.categoryId },
      }),
    ).rejects.toThrow();
  });
});

describe("borrado lógico", () => {
  it("las filas borradas no aparecen en las lecturas", async () => {
    const db = forSpace(a.spaceId);
    const tag = await db.tag.create({
      data: { name: "a-borrar", spaceId: a.spaceId },
    });

    await db.tag.update({
      where: { id: tag.id },
      data: { deletedAt: new Date() },
    });

    expect(await db.tag.findFirst({ where: { id: tag.id } })).toBeNull();
    expect(await db.tag.count({ where: { id: tag.id } })).toBe(0);
  });

  it("se pueden ver con forSpaceWithDeleted, sin perder el scope", async () => {
    const db = forSpace(a.spaceId);
    const tag = await db.tag.create({
      data: { name: "papelera", spaceId: a.spaceId },
    });
    await db.tag.update({
      where: { id: tag.id },
      data: { deletedAt: new Date() },
    });

    const withDeleted = forSpaceWithDeleted(a.spaceId);
    expect(
      await withDeleted.tag.findFirst({ where: { id: tag.id } }),
    ).not.toBeNull();

    // Sigue sin ver el otro Space.
    expect(
      await withDeleted.transaction.findFirst({
        where: { id: b.transactionId },
      }),
    ).toBeNull();
  });

  it("los modelos sin deletedAt no reciben el filtro", async () => {
    // Membership no tiene borrado lógico: si se le inyectara deletedAt,
    // Postgres rechazaría la consulta por columna inexistente.
    const memberships = await forSpace(a.spaceId).membership.findMany();
    expect(memberships).toHaveLength(1);
    expect(memberships[0]?.userId).toBe(a.ownerId);
  });
});

describe("modelos fuera del dominio del Space", () => {
  it("los modelos de identidad no son accesibles desde un cliente scopeado", async () => {
    const db = forSpace(a.spaceId);

    await expect(db.user.findMany()).rejects.toThrow(SpaceScopeError);
    await expect(db.refreshToken.findMany()).rejects.toThrow(SpaceScopeError);
    await expect(db.verificationToken.findMany()).rejects.toThrow(
      SpaceScopeError,
    );
  });

  it("los datos de los miembros se leen anidados desde Membership", async () => {
    // El camino legítimo para mostrar avatares y nombres en un Space compartido.
    const memberships = await forSpace(a.spaceId).membership.findMany({
      include: { user: { select: { id: true, name: true } } },
    });

    expect(memberships[0]?.user.name).toBe("Dueño A");
  });

  it("Space se acota a su propia fila", async () => {
    const db = forSpace(a.spaceId);

    const own = await db.space.findFirst();
    expect(own?.id).toBe(a.spaceId);

    const other = await db.space.findFirst({ where: { id: b.spaceId } });
    expect(other).toBeNull();

    expect(await db.space.count()).toBe(1);
  });

  it("ExchangeRate es global y pasa sin filtro", async () => {
    await forSpace(a.spaceId).exchangeRate.create({
      data: {
        baseCurrency: "EUR",
        quoteCurrency: "ARS",
        date: new Date("2026-08-05T00:00:00Z"),
        rate: "1150.5",
      },
    });

    // Visible desde cualquier Space: las cotizaciones no son de nadie.
    const fromB = await forSpace(b.spaceId).exchangeRate.findMany();
    expect(fromB).toHaveLength(1);
  });
});

describe("uso incorrecto", () => {
  it("forSpace exige un spaceId no vacío", () => {
    expect(() => forSpace("")).toThrow(SpaceScopeError);
  });
});
