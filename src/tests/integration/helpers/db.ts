import { systemClient } from "@/server/db/system";

/**
 * Utilidades para los tests de integración.
 *
 * Usan `systemClient()` a propósito: montar y limpiar fixtures es exactamente
 * el caso en que hace falta cruzar Spaces. Lo que se pone a prueba es que el
 * cliente SCOPEADO no pueda hacer lo mismo.
 */

const db = systemClient();

/** Vacía todas las tablas de dominio, dejando el historial de migraciones. */
export const resetDatabase = async (): Promise<void> => {
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename NOT LIKE '\\_prisma%'
  `;

  if (tables.length === 0) return;

  const list = tables.map((t) => `"public"."${t.tablename}"`).join(", ");
  await db.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
};

export const disconnect = async (): Promise<void> => {
  await db.$disconnect();
};

export { db as testDb };

// ─────────────────────────────── fixtures ────────────────────────────────────

let counter = 0;
const uniq = (prefix: string): string => {
  counter += 1;
  return `${prefix}-${counter.toString().padStart(4, "0")}`;
};

export interface SpaceFixture {
  readonly spaceId: string;
  readonly ownerId: string;
  readonly accountId: string;
  readonly categoryId: string;
  readonly transactionId: string;
}

/**
 * Crea un Space completo y autónomo: dueño, cuenta, categoría y una
 * transacción. Los tests de aislamiento arman dos de estos y verifican que
 * ninguno pueda ver nada del otro.
 */
export const createSpaceFixture = async (
  label: string,
): Promise<SpaceFixture> => {
  const user = await db.user.create({
    data: {
      email: `${uniq(label.toLowerCase())}@monkey.test`,
      passwordHash: "hash-de-mentira",
      name: `Dueño ${label}`,
      timezone: "Europe/Madrid",
      locale: "es-ES",
      emailVerifiedAt: new Date(),
    },
  });

  const space = await db.space.create({
    data: {
      name: `Space ${label}`,
      primaryCurrency: "EUR",
      timezone: "Europe/Madrid",
      memberships: { create: { userId: user.id, role: "OWNER" } },
    },
  });

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
    data: {
      spaceId: space.id,
      name: `Categoría ${label}`,
      kind: "EXPENSE",
    },
  });

  const transaction = await db.transaction.create({
    data: {
      spaceId: space.id,
      accountId: account.id,
      categoryId: category.id,
      createdByUserId: user.id,
      createdByName: user.name,
      type: "EXPENSE",
      amountMinor: 2500n,
      currency: "EUR",
      date: new Date("2026-08-01T00:00:00Z"),
      description: `Gasto de ${label}`,
    },
  });

  return {
    spaceId: space.id,
    ownerId: user.id,
    accountId: account.id,
    categoryId: category.id,
    transactionId: transaction.id,
  };
};
