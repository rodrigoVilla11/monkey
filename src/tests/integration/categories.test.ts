import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { forSpace } from "@/server/db/scoped";
import { systemClient } from "@/server/db/system";
import {
  createCategory,
  deleteCategory,
  listCategories,
  updateCategory,
} from "@/server/services/categories";
import {
  createTransaction,
  listTransactions,
} from "@/server/services/transactions";

import { disconnect, resetDatabase, testDb } from "./helpers/db";

/**
 * Categorías contra Postgres real.
 *
 * Lo que más importa: **archivar no es borrar**. Archivar la saca del selector
 * y no toca una sola fila del pasado; borrar reasigna los movimientos que la
 * usaban, o sea que reescribe en qué se gastó. Si esa diferencia se difumina,
 * dejar de usar una categoría pasa a costar el historial.
 */

const TIMEZONE = "Europe/Madrid";

interface Space {
  readonly spaceId: string;
  readonly accountId: string;
  readonly userId: string;
}

let counter = 0;

const makeSpace = async (): Promise<Space> => {
  counter += 1;
  const label = counter.toString().padStart(3, "0");

  const user = await testDb.user.create({
    data: {
      email: `cats-${label}@monkey.test`,
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
      primaryCurrency: "EUR",
      timezone: TIMEZONE,
      memberships: { create: { userId: user.id, role: "OWNER" } },
    },
  });

  const account = await forSpace(space.id).account.create({
    data: {
      spaceId: space.id,
      name: "Corriente",
      type: "BANK",
      currency: "EUR",
      initialBalanceMinor: 1_000_000n,
    },
  });

  return { spaceId: space.id, accountId: account.id, userId: user.id };
};

const addCategory = (
  space: Space,
  name: string,
  parentId: string | null = null,
) =>
  createCategory(forSpace(space.spaceId), space.spaceId, {
    name,
    kind: "EXPENSE",
    parentId,
  });

const spend = (space: Space, categoryId: string | null) =>
  systemClient().$transaction(async (tx) =>
    createTransaction(
      forSpace(space.spaceId),
      tx,
      {
        spaceId: space.spaceId,
        primaryCurrency: "EUR",
        timezone: TIMEZONE,
      },
      { userId: space.userId, name: "Rodrigo", timezone: TIMEZONE },
      {
        accountId: space.accountId,
        categoryId,
        type: "EXPENSE",
        amountMinor: "10000",
        date: "2026-03-01",
      },
    ),
  );

const names = (tree: { name: string }[]): string[] => tree.map((c) => c.name);

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await disconnect();
});

describe("archivar no es borrar", () => {
  it("la archivada desaparece del selector pero se puede pedir", async () => {
    const space = await makeSpace();
    const taxi = await addCategory(space, "Taxi");

    await updateCategory(forSpace(space.spaceId), taxi.id, {
      isArchived: true,
    });

    const paraCargar = await listCategories(forSpace(space.spaceId), {
      kind: "EXPENSE",
    });
    expect(names(paraCargar)).not.toContain("Taxi");

    const paraAdministrar = await listCategories(forSpace(space.spaceId), {
      kind: "EXPENSE",
      includeArchived: true,
    });
    expect(names(paraAdministrar)).toContain("Taxi");
  });

  it("el historial queda intacto", async () => {
    const space = await makeSpace();
    const taxi = await addCategory(space, "Taxi");
    await spend(space, taxi.id);

    await updateCategory(forSpace(space.spaceId), taxi.id, {
      isArchived: true,
    });

    const movimientos = await listTransactions(
      forSpace(space.spaceId),
      "EUR",
      {},
      { limit: 20 },
    );

    // El movimiento sigue siendo de Taxi: archivar no reescribe el pasado.
    expect(movimientos.items[0]?.category?.name).toBe("Taxi");
  });

  it("no se puede cargar un movimiento nuevo en una archivada", async () => {
    const space = await makeSpace();
    const taxi = await addCategory(space, "Taxi");

    await updateCategory(forSpace(space.spaceId), taxi.id, {
      isArchived: true,
    });

    await expect(spend(space, taxi.id)).rejects.toThrow(/archivada/i);
  });

  it("archivar una madre archiva sus hijas, y desarchivarla las devuelve", async () => {
    const space = await makeSpace();
    const transporte = await addCategory(space, "Transporte");
    await addCategory(space, "Taxi", transporte.id);
    await addCategory(space, "Nafta", transporte.id);

    await updateCategory(forSpace(space.spaceId), transporte.id, {
      isArchived: true,
    });

    const sinNada = await listCategories(forSpace(space.spaceId), {
      kind: "EXPENSE",
    });
    expect(names(sinNada)).not.toContain("Transporte");

    // Sin la cascada, las hijas quedarían activas colgando de una madre que no
    // se muestra: desaparecerían de la pantalla sin que nadie lo haya pedido.
    const todas = await listCategories(forSpace(space.spaceId), {
      kind: "EXPENSE",
      includeArchived: true,
    });
    const madre = todas.find((c) => c.name === "Transporte");
    expect(madre?.children.every((child) => child.isArchived)).toBe(true);

    await updateCategory(forSpace(space.spaceId), transporte.id, {
      isArchived: false,
    });

    const vueltas = await listCategories(forSpace(space.spaceId), {
      kind: "EXPENSE",
    });
    expect(
      vueltas.find((c) => c.name === "Transporte")?.children.map((c) => c.name),
    ).toEqual(["Taxi", "Nafta"]);
  });

  it("borrar sí reescribe el pasado, y por eso es otra acción", async () => {
    const space = await makeSpace();
    const taxi = await addCategory(space, "Taxi");
    const transporte = await addCategory(space, "Transporte");
    await spend(space, taxi.id);

    const result = await systemClient().$transaction(async (tx) =>
      deleteCategory(
        forSpace(space.spaceId),
        tx,
        space.spaceId,
        taxi.id,
        transporte.id,
        { userId: space.userId, name: "Rodrigo" },
      ),
    );

    expect(result.reassignedTransactions).toBe(1);

    const movimientos = await listTransactions(
      forSpace(space.spaceId),
      "EUR",
      {},
      { limit: 20 },
    );
    expect(movimientos.items[0]?.category?.name).toBe("Transporte");
  });
});
