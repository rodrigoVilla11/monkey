import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { requireSpaceAccess } from "@/server/api/authorize";
import { SPACE_SCOPED_ROUTES, routeKey } from "@/server/api/routes.manifest";
import { forSpace } from "@/server/db/scoped";
import {
  getAccount,
  listAccounts,
  updateAccount,
} from "@/server/services/accounts";
import { listCategories, updateCategory } from "@/server/services/categories";
import { getDashboard } from "@/server/services/reports/dashboard";
import {
  bulkDeleteTransactions,
  createTransaction,
  deleteTransaction,
  getTransaction,
  listTransactions,
  updateTransaction,
} from "@/server/services/transactions";
import { systemClient } from "@/server/db/system";

import { disconnect, resetDatabase, testDb } from "./helpers/db";

/**
 * ⭐ EL TEST QUE MÁS IMPORTA DEL BRIEF.
 *
 * Se montan dos Spaces completos con datos reales y se comprueba que ningún
 * camino del código deje ver o tocar nada del otro — **ni siquiera pasando IDs
 * válidos del otro Space** por path, body o query, que es exactamente el
 * ataque que importa.
 *
 * Hay tres capas de defensa y cada una se prueba por separado:
 *
 *   1. `requireSpaceAccess` — no sos miembro → 404 (nunca 403)
 *   2. La extensión de scope — un ID ajeno no aparece en ninguna consulta
 *   3. Las claves foráneas compuestas — enlazar entidades de Spaces distintos
 *      es un error de PostgreSQL, no un bug silencioso
 *
 * El recorrido de endpoints sale del manifiesto, así que un endpoint nuevo
 * entra solo: `routes-manifest.test.ts` falla si alguno no está declarado.
 */

interface Fixture {
  readonly spaceId: string;
  readonly userId: string;
  readonly userName: string;
  readonly accountId: string;
  readonly categoryId: string;
  readonly transactionId: string;
  readonly tagId: string;
}

let a: Fixture;
let b: Fixture;

const buildFixture = async (label: string): Promise<Fixture> => {
  const user = await testDb.user.create({
    data: {
      // En minúscula: hay un CHECK en la base que exige el email normalizado.
      email: `${label.toLowerCase()}@aislamiento.test`,
      passwordHash: "hash",
      name: `Dueño ${label}`,
      timezone: "Europe/Madrid",
      locale: "es-ES",
      emailVerifiedAt: new Date(),
    },
  });

  const space = await testDb.space.create({
    data: {
      name: `Space ${label}`,
      primaryCurrency: "EUR",
      timezone: "Europe/Madrid",
      memberships: { create: { userId: user.id, role: "OWNER" } },
    },
  });

  const db = forSpace(space.id);

  const account = await db.account.create({
    data: {
      spaceId: space.id,
      name: `Cuenta ${label}`,
      type: "BANK",
      currency: "EUR",
      initialBalanceMinor: 100_000n,
    },
  });

  const category = await db.category.create({
    data: { spaceId: space.id, name: `Gastos ${label}`, kind: "EXPENSE" },
  });

  const tag = await db.tag.create({
    data: { spaceId: space.id, name: `etiqueta-${label}` },
  });

  const transaction = await db.transaction.create({
    data: {
      spaceId: space.id,
      accountId: account.id,
      categoryId: category.id,
      createdByUserId: user.id,
      createdByName: user.name,
      type: "EXPENSE",
      amountMinor: 5_000n,
      currency: "EUR",
      date: new Date("2026-08-05T00:00:00Z"),
      description: `Gasto de ${label}`,
    },
  });

  return {
    spaceId: space.id,
    userId: user.id,
    userName: user.name,
    accountId: account.id,
    categoryId: category.id,
    transactionId: transaction.id,
    tagId: tag.id,
  };
};

beforeAll(async () => {
  await resetDatabase();
  a = await buildFixture("A");
  b = await buildFixture("B");
});

afterAll(async () => {
  await resetDatabase();
  await disconnect();
});

const dbA = () => forSpace(a.spaceId);
const spaceCtx = () => ({
  spaceId: a.spaceId,
  primaryCurrency: "EUR",
  timezone: "Europe/Madrid",
});

// ─────────────────── capa 1: resolución de acceso ────────────────────────────

describe("capa 1 · ningún endpoint es accesible desde fuera del Space", () => {
  for (const spec of SPACE_SCOPED_ROUTES) {
    it(`${routeKey(spec)} → 404 para quien no es miembro`, async () => {
      // 404 y no 403: un 403 confirmaría que el Space existe.
      await expect(
        requireSpaceAccess(a.userId, b.spaceId, spec.minRole),
      ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    });
  }
});

// ──────────────────── capa 2: la extensión de scope ──────────────────────────

describe("capa 2 · lecturas con IDs válidos del otro Space", () => {
  it("el listado de cuentas solo trae las propias", async () => {
    const accounts = await listAccounts(dbA());
    expect(accounts).toHaveLength(1);
    expect(accounts[0]?.id).toBe(a.accountId);
  });

  it("getAccount con el ID de una cuenta ajena da 404", async () => {
    await expect(getAccount(dbA(), b.accountId)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("getTransaction con un ID ajeno da 404", async () => {
    await expect(
      getTransaction(dbA(), "EUR", b.transactionId),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("filtrar por un accountId ajeno no devuelve nada", async () => {
    // El filtro es válido y el ID existe... en otro Space.
    const page = await listTransactions(
      dbA(),
      "EUR",
      { accountId: [b.accountId] },
      { limit: 30 },
    );
    expect(page.items).toHaveLength(0);
  });

  it("filtrar por una categoría ajena no devuelve nada", async () => {
    const page = await listTransactions(
      dbA(),
      "EUR",
      { categoryId: [b.categoryId] },
      { limit: 30 },
    );
    expect(page.items).toHaveLength(0);
  });

  it("filtrar por el autor del otro Space no devuelve nada", async () => {
    const page = await listTransactions(
      dbA(),
      "EUR",
      { createdByUserId: [b.userId] },
      { limit: 30 },
    );
    expect(page.items).toHaveLength(0);
  });

  it("filtrar por una etiqueta ajena no devuelve nada", async () => {
    const page = await listTransactions(
      dbA(),
      "EUR",
      { tagId: [b.tagId] },
      { limit: 30 },
    );
    expect(page.items).toHaveLength(0);
  });

  it("mezclar un ID propio con uno ajeno solo trae el propio", async () => {
    const page = await listTransactions(
      dbA(),
      "EUR",
      { accountId: [a.accountId, b.accountId] },
      { limit: 30 },
    );
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.id).toBe(a.transactionId);
  });

  it("un cursor de paginación del otro Space no sirve para escaparse", async () => {
    const page = await listTransactions(
      dbA(),
      "EUR",
      {},
      { cursor: b.transactionId, limit: 30 },
    );
    expect(page.items.every((t) => t.account.id === a.accountId)).toBe(true);
  });

  it("el árbol de categorías solo trae las propias", async () => {
    const categories = await listCategories(dbA());
    const ids = categories.flatMap((c) => [
      c.id,
      ...c.children.map((x) => x.id),
    ]);
    expect(ids).toContain(a.categoryId);
    expect(ids).not.toContain(b.categoryId);
  });

  it("el dashboard no incluye nada del otro Space", async () => {
    const dashboard = await getDashboard(
      dbA(),
      { primaryCurrency: "EUR", timezone: "Europe/Madrid" },
      "Europe/Madrid",
      "2026-08-05",
    );

    // Solo la cuenta propia, y el gasto propio: 5.000, no 10.000.
    expect(dashboard.accounts).toHaveLength(1);
    expect(dashboard.accounts[0]?.accountId).toBe(a.accountId);
    expect(dashboard.month.expense.amountMinor).toBe("5000");
    expect(dashboard.netWorth.byCurrency[0]?.amountMinor).toBe("95000");
  });
});

describe("capa 2 · escrituras con IDs válidos del otro Space", () => {
  it("no se puede modificar una cuenta ajena", async () => {
    await expect(
      updateAccount(dbA(), b.accountId, { name: "Secuestrada" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const untouched = await testDb.account.findUnique({
      where: { id: b.accountId },
    });
    expect(untouched?.name).toBe("Cuenta B");
  });

  it("no se puede modificar una categoría ajena", async () => {
    await expect(
      updateCategory(dbA(), b.categoryId, { name: "Secuestrada" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("no se puede modificar una transacción ajena", async () => {
    await expect(
      systemClient().$transaction(async (tx) => {
        await updateTransaction(dbA(), tx, spaceCtx(), b.transactionId, {
          description: "Modificada desde A",
        });
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const untouched = await testDb.transaction.findUnique({
      where: { id: b.transactionId },
    });
    expect(untouched?.description).toBe("Gasto de B");
  });

  it("no se puede borrar una transacción ajena", async () => {
    await expect(
      systemClient().$transaction(async (tx) => {
        await deleteTransaction(dbA(), tx, b.transactionId);
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const untouched = await testDb.transaction.findUnique({
      where: { id: b.transactionId },
    });
    expect(untouched?.deletedAt).toBeNull();
  });

  it("el borrado masivo ignora los IDs del otro Space", async () => {
    const deleted = await systemClient().$transaction(async (tx) =>
      bulkDeleteTransactions(dbA(), tx, a.spaceId, [b.transactionId], {
        userId: a.userId,
        name: a.userName,
      }),
    );

    expect(deleted).toBe(0);
    const untouched = await testDb.transaction.findUnique({
      where: { id: b.transactionId },
    });
    expect(untouched?.deletedAt).toBeNull();
  });
});

// ────────────────── capa 3: claves foráneas compuestas ───────────────────────

describe("capa 3 · no se pueden enlazar entidades de Spaces distintos", () => {
  it("crear un movimiento con una cuenta ajena da 404, no lo crea", async () => {
    await expect(
      systemClient().$transaction(async (tx) =>
        createTransaction(
          dbA(),
          tx,
          spaceCtx(),
          { userId: a.userId, name: a.userName, timezone: "Europe/Madrid" },
          {
            accountId: b.accountId,
            type: "EXPENSE",
            amountMinor: "1000",
          },
        ),
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("crear un movimiento con una categoría ajena da 404", async () => {
    await expect(
      systemClient().$transaction(async (tx) =>
        createTransaction(
          dbA(),
          tx,
          spaceCtx(),
          { userId: a.userId, name: a.userName, timezone: "Europe/Madrid" },
          {
            accountId: a.accountId,
            categoryId: b.categoryId,
            type: "EXPENSE",
            amountMinor: "1000",
          },
        ),
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("crear un movimiento con una etiqueta ajena da 404", async () => {
    await expect(
      systemClient().$transaction(async (tx) =>
        createTransaction(
          dbA(),
          tx,
          spaceCtx(),
          { userId: a.userId, name: a.userName, timezone: "Europe/Madrid" },
          {
            accountId: a.accountId,
            type: "EXPENSE",
            amountMinor: "1000",
            tagIds: [b.tagId],
          },
        ),
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("aunque se esquiven los services, PostgreSQL lo rechaza", async () => {
    // Última línea de defensa: la clave foránea compuesta (spaceId, accountId).
    // Esto simula un service con un bug que no valida el accountId del body.
    await expect(
      dbA().transaction.create({
        data: {
          spaceId: a.spaceId,
          accountId: b.accountId,
          createdByName: "atacante",
          type: "EXPENSE",
          amountMinor: 1000n,
          currency: "EUR",
          date: new Date("2026-08-05T00:00:00Z"),
        },
      }),
    ).rejects.toThrow();
  });

  it("tampoco por la puerta de atrás del cliente sin scope", async () => {
    await expect(
      testDb.transaction.create({
        data: {
          spaceId: a.spaceId,
          accountId: b.accountId,
          createdByName: "atacante",
          type: "EXPENSE",
          amountMinor: 1000n,
          currency: "EUR",
          date: new Date("2026-08-05T00:00:00Z"),
        },
      }),
    ).rejects.toThrow();
  });
});

// ───────────────────────── el otro Space, intacto ────────────────────────────

describe("después de todos los intentos, el Space B quedó intacto", () => {
  it("conserva exactamente sus datos originales", async () => {
    const dbB = forSpace(b.spaceId);

    expect(await dbB.account.count()).toBe(1);
    expect(await dbB.transaction.count()).toBe(1);
    expect(await dbB.tag.count()).toBe(1);

    const transaction = await dbB.transaction.findFirstOrThrow();
    expect(transaction.description).toBe("Gasto de B");
    expect(transaction.amountMinor).toBe(5_000n);
    expect(transaction.deletedAt).toBeNull();

    const accounts = await listAccounts(dbB);
    expect(accounts[0]?.balance.amountMinor).toBe("95000");
  });
});
