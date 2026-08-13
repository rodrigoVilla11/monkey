import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { forSpace } from "@/server/db/scoped";
import {
  budgetSummary,
  createBudget,
  deleteBudget,
  getBudget,
  listBudgets,
  updateBudget,
} from "@/server/services/budgets";

import { disconnect, resetDatabase, testDb } from "./helpers/db";

/**
 * Presupuestos contra Postgres real.
 *
 * Lo que se prueba acá y no en los unitarios: que el gasto se agregue bien en
 * SQL —incluyendo subcategorías, excluyendo transferencias y respetando la
 * conversión congelada— y que el aislamiento entre Spaces se sostenga.
 */

const TIMEZONE = "Europe/Madrid";

interface Fixture {
  readonly spaceId: string;
  readonly userId: string;
  readonly accountId: string;
  /** Segunda cuenta, para probar el alcance por cuentas. */
  readonly otherAccountId: string;
  readonly parentCategoryId: string;
  readonly childCategoryId: string;
  readonly otherCategoryId: string;
}

let a: Fixture;
let b: Fixture;

const buildFixture = async (label: string): Promise<Fixture> => {
  const user = await testDb.user.create({
    data: {
      email: `${label}@budgets.test`,
      passwordHash: "hash",
      name: `Dueño ${label}`,
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

  const db = forSpace(space.id);

  const account = await db.account.create({
    data: {
      spaceId: space.id,
      name: "Cuenta",
      type: "BANK",
      currency: "EUR",
      initialBalanceMinor: 1_000_000n,
    },
  });

  const otherAccount = await db.account.create({
    data: {
      spaceId: space.id,
      name: "Tarjeta",
      type: "CREDIT_CARD",
      currency: "EUR",
    },
  });

  const parent = await db.category.create({
    data: { spaceId: space.id, name: "Alimentación", kind: "EXPENSE" },
  });
  const child = await db.category.create({
    data: {
      spaceId: space.id,
      name: "Supermercado",
      kind: "EXPENSE",
      parentId: parent.id,
    },
  });
  const other = await db.category.create({
    data: { spaceId: space.id, name: "Transporte", kind: "EXPENSE" },
  });

  return {
    spaceId: space.id,
    userId: user.id,
    accountId: account.id,
    otherAccountId: otherAccount.id,
    parentCategoryId: parent.id,
    childCategoryId: child.id,
    otherCategoryId: other.id,
  };
};

/** Carga un gasto en el Space A. */
const spend = async (
  fixture: Fixture,
  amountMinor: bigint,
  date: string,
  categoryId: string | null,
  extra: {
    readonly currency?: string;
    readonly amountPrimaryMinor?: bigint;
    readonly type?: "EXPENSE" | "INCOME" | "TRANSFER";
    readonly transferDirection?: "OUT" | "IN";
    readonly accountId?: string;
  } = {},
): Promise<void> => {
  const type = extra.type ?? "EXPENSE";

  await forSpace(fixture.spaceId).transaction.create({
    data: {
      spaceId: fixture.spaceId,
      accountId: extra.accountId ?? fixture.accountId,
      categoryId,
      createdByUserId: fixture.userId,
      createdByName: "Dueño",
      type,
      amountMinor,
      currency: extra.currency ?? "EUR",
      date: new Date(`${date}T00:00:00Z`),
      ...(extra.amountPrimaryMinor !== undefined
        ? {
            amountPrimaryMinor: extra.amountPrimaryMinor,
            exchangeRateSnapshot: "0.001",
          }
        : {}),
      ...(type === "TRANSFER"
        ? {
            transferGroupId: `grupo-${String(amountMinor)}`,
            transferDirection: extra.transferDirection ?? "OUT",
          }
        : {}),
    },
  });
};

beforeEach(async () => {
  await resetDatabase();
  a = await buildFixture("a");
  b = await buildFixture("b");
});

afterAll(async () => {
  await resetDatabase();
  await disconnect();
});

describe("creación", () => {
  it("usa siempre la moneda primaria del Space", async () => {
    // Sumar gastos en dos monedas contra un tope no significa nada.
    const budget = await createBudget(
      forSpace(a.spaceId),
      a.spaceId,
      "EUR",
      TIMEZONE,
      { name: "Comida", period: "MONTHLY", amountMinor: "50000" },
    );

    expect(budget.amount.currency).toBe("EUR");
  });

  it("no deja presupuestar una categoría de ingresos", async () => {
    const db = forSpace(a.spaceId);
    const income = await db.category.create({
      data: { spaceId: a.spaceId, name: "Salario", kind: "INCOME" },
    });

    await expect(
      createBudget(db, a.spaceId, "EUR", TIMEZONE, {
        name: "Absurdo",
        period: "MONTHLY",
        amountMinor: "50000",
        categoryId: income.id,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("permite dos presupuestos sobre la misma categoría", async () => {
    // Es lo que hace útil el alcance por cuentas: "comida con la tarjeta" y
    // "comida en efectivo" son dos topes distintos sobre la misma categoría.
    const db = forSpace(a.spaceId);
    const input = {
      name: "Comida",
      period: "MONTHLY" as const,
      amountMinor: "50000",
      categoryId: a.parentCategoryId,
    };

    await createBudget(db, a.spaceId, "EUR", TIMEZONE, {
      ...input,
      accountIds: [a.accountId],
    });
    await createBudget(db, a.spaceId, "EUR", TIMEZONE, {
      ...input,
      name: "Comida tarjeta",
      accountIds: [a.otherAccountId],
    });

    expect(await listBudgets(db, TIMEZONE)).toHaveLength(2);
  });

  it("guarda el alcance por cuentas y lo devuelve", async () => {
    const budget = await createBudget(
      forSpace(a.spaceId),
      a.spaceId,
      "EUR",
      TIMEZONE,
      {
        name: "Tarjetas",
        period: "MONTHLY",
        amountMinor: "50000",
        accountIds: [a.otherAccountId, a.otherAccountId],
      },
    );

    // El id repetido no duplica la fila: se deduplica antes de escribir.
    expect(budget.accounts.map((account) => account.id)).toEqual([
      a.otherAccountId,
    ]);
  });

  it("sin cuentas el presupuesto alcanza todas", async () => {
    const budget = await createBudget(
      forSpace(a.spaceId),
      a.spaceId,
      "EUR",
      TIMEZONE,
      { name: "Global", period: "MONTHLY", amountMinor: "50000" },
    );

    expect(budget.accounts).toEqual([]);
  });

  it("rechaza una categoría de otro Space con 404", async () => {
    await expect(
      createBudget(forSpace(a.spaceId), a.spaceId, "EUR", TIMEZONE, {
        name: "Ajeno",
        period: "MONTHLY",
        amountMinor: "50000",
        categoryId: b.parentCategoryId,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rechaza una cuenta de otro Space con 404", async () => {
    await expect(
      createBudget(forSpace(a.spaceId), a.spaceId, "EUR", TIMEZONE, {
        name: "Ajeno",
        period: "MONTHLY",
        amountMinor: "50000",
        accountIds: [b.accountId],
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("cálculo del gasto", () => {
  const monthly = (categoryId: string | null, amountMinor = "50000") => ({
    name: "Presupuesto",
    period: "MONTHLY" as const,
    amountMinor,
    categoryId,
    startDate: "2026-01-01",
  });

  it("un presupuesto de categoría padre INCLUYE sus subcategorías", async () => {
    // Nadie piensa su presupuesto de comida como excluyendo el súper.
    const db = forSpace(a.spaceId);
    const today = todayInFixture();

    await spend(a, 10_000n, today, a.parentCategoryId);
    await spend(a, 15_000n, today, a.childCategoryId);
    await spend(a, 99_000n, today, a.otherCategoryId);

    const budget = await createBudget(
      db,
      a.spaceId,
      "EUR",
      TIMEZONE,
      monthly(a.parentCategoryId),
    );

    // 100 + 150 de la padre y su hija. Los 990 de Transporte no cuentan.
    expect(budget.spent.amountMinor).toBe("25000");
  });

  it("un presupuesto global cuenta TODOS los gastos", async () => {
    const today = todayInFixture();
    await spend(a, 10_000n, today, a.parentCategoryId);
    await spend(a, 99_000n, today, a.otherCategoryId);
    await spend(a, 1_000n, today, null);

    const budget = await createBudget(
      forSpace(a.spaceId),
      a.spaceId,
      "EUR",
      TIMEZONE,
      monthly(null, "200000"),
    );

    expect(budget.spent.amountMinor).toBe("110000");
  });

  it("los ingresos NO consumen presupuesto", async () => {
    const today = todayInFixture();
    await spend(a, 10_000n, today, a.parentCategoryId);
    await spend(a, 500_000n, today, null, { type: "INCOME" });

    const budget = await createBudget(
      forSpace(a.spaceId),
      a.spaceId,
      "EUR",
      TIMEZONE,
      monthly(null),
    );

    expect(budget.spent.amountMinor).toBe("10000");
  });

  it("las TRANSFERENCIAS no consumen presupuesto", async () => {
    // Mover plata entre cuentas propias no es un gasto.
    const today = todayInFixture();
    await spend(a, 10_000n, today, a.parentCategoryId);
    await spend(a, 300_000n, today, null, {
      type: "TRANSFER",
      transferDirection: "OUT",
    });

    const budget = await createBudget(
      forSpace(a.spaceId),
      a.spaceId,
      "EUR",
      TIMEZONE,
      monthly(null),
    );

    expect(budget.spent.amountMinor).toBe("10000");
  });

  it("usa el importe convertido y congelado en gastos de otra moneda", async () => {
    const today = todayInFixture();
    // 150.000 ARS que al cargarse valían 130 €.
    await spend(a, 150_000n, today, a.parentCategoryId, {
      currency: "ARS",
      amountPrimaryMinor: 13_000n,
    });

    const budget = await createBudget(
      forSpace(a.spaceId),
      a.spaceId,
      "EUR",
      TIMEZONE,
      monthly(a.parentCategoryId),
    );

    // Cuenta 130 €, no 150.000 unidades sueltas.
    expect(budget.spent.amountMinor).toBe("13000");
  });

  it("un presupuesto acotado a cuentas ignora el gasto de las demás", async () => {
    const today = todayInFixture();
    await spend(a, 10_000n, today, a.parentCategoryId);
    await spend(a, 25_000n, today, a.parentCategoryId, {
      accountId: a.otherAccountId,
    });

    const budget = await createBudget(
      forSpace(a.spaceId),
      a.spaceId,
      "EUR",
      TIMEZONE,
      { ...monthly(a.parentCategoryId), accountIds: [a.otherAccountId] },
    );

    // Solo los 250 de la tarjeta. Los 100 de la otra cuenta no son de este
    // presupuesto, aunque sean de la misma categoría.
    expect(budget.spent.amountMinor).toBe("25000");
  });

  it("el filtro de cuentas se aplica JUNTO con el de categoría", async () => {
    const today = todayInFixture();
    // Misma cuenta, categorías distintas.
    await spend(a, 10_000n, today, a.parentCategoryId, {
      accountId: a.otherAccountId,
    });
    await spend(a, 70_000n, today, a.otherCategoryId, {
      accountId: a.otherAccountId,
    });

    const budget = await createBudget(
      forSpace(a.spaceId),
      a.spaceId,
      "EUR",
      TIMEZONE,
      { ...monthly(a.parentCategoryId), accountIds: [a.otherAccountId] },
    );

    expect(budget.spent.amountMinor).toBe("10000");
  });

  it("varias cuentas suman entre sí", async () => {
    const today = todayInFixture();
    await spend(a, 10_000n, today, null);
    await spend(a, 25_000n, today, null, { accountId: a.otherAccountId });

    const budget = await createBudget(
      forSpace(a.spaceId),
      a.spaceId,
      "EUR",
      TIMEZONE,
      {
        ...monthly(null, "200000"),
        accountIds: [a.accountId, a.otherAccountId],
      },
    );

    expect(budget.spent.amountMinor).toBe("35000");
  });

  it("no cuenta gastos fuera del período en curso", async () => {
    const db = forSpace(a.spaceId);
    await spend(a, 20_000n, "2026-01-15", a.parentCategoryId);
    await spend(a, 5_000n, todayInFixture(), a.parentCategoryId);

    const budget = await createBudget(
      db,
      a.spaceId,
      "EUR",
      TIMEZONE,
      monthly(a.parentCategoryId),
    );

    // Enero quedó atrás; solo cuenta lo del mes actual.
    expect(budget.spent.amountMinor).toBe("5000");
  });
});

describe("estados y alertas", () => {
  const make = async (amountMinor: string, spentMinor: bigint) => {
    await spend(a, spentMinor, todayInFixture(), a.parentCategoryId);
    return createBudget(forSpace(a.spaceId), a.spaceId, "EUR", TIMEZONE, {
      name: "Comida",
      period: "MONTHLY",
      amountMinor,
      categoryId: a.parentCategoryId,
    });
  };

  it("OK por debajo del 80%", async () => {
    const budget = await make("50000", 20_000n);
    expect(budget.state).toBe("OK");
    expect(budget.remaining.amountMinor).toBe("30000");
  });

  it("WARNING a partir del 80%", async () => {
    const budget = await make("50000", 42_000n);
    expect(budget.state).toBe("WARNING");
    expect(budget.percentage).toBe(84);
  });

  it("OVER con sobregiro y restante negativo", async () => {
    const budget = await make("50000", 62_000n);
    expect(budget.state).toBe("OVER");
    expect(budget.remaining.amountMinor).toBe("-12000");
  });
});

describe("edición del alcance por cuentas", () => {
  it("REEMPLAZA la lista entera, no la suma", async () => {
    const db = forSpace(a.spaceId);
    const budget = await createBudget(db, a.spaceId, "EUR", TIMEZONE, {
      name: "Comida",
      period: "MONTHLY",
      amountMinor: "50000",
      accountIds: [a.accountId],
    });

    const updated = await updateBudget(db, TIMEZONE, budget.id, {
      accountIds: [a.otherAccountId],
    });

    expect(updated.accounts.map((account) => account.id)).toEqual([
      a.otherAccountId,
    ]);
  });

  it("una lista vacía lo devuelve a todas las cuentas", async () => {
    const db = forSpace(a.spaceId);
    const today = todayInFixture();
    await spend(a, 10_000n, today, null);
    await spend(a, 25_000n, today, null, { accountId: a.otherAccountId });

    const budget = await createBudget(db, a.spaceId, "EUR", TIMEZONE, {
      name: "Comida",
      period: "MONTHLY",
      amountMinor: "200000",
      accountIds: [a.accountId],
    });
    expect(budget.spent.amountMinor).toBe("10000");

    const updated = await updateBudget(db, TIMEZONE, budget.id, {
      accountIds: [],
    });

    expect(updated.accounts).toEqual([]);
    expect(updated.spent.amountMinor).toBe("35000");
  });

  it("no tocar accountIds deja el alcance como estaba", async () => {
    const db = forSpace(a.spaceId);
    const budget = await createBudget(db, a.spaceId, "EUR", TIMEZONE, {
      name: "Comida",
      period: "MONTHLY",
      amountMinor: "50000",
      accountIds: [a.accountId],
    });

    const updated = await updateBudget(db, TIMEZONE, budget.id, {
      name: "Comida y bebida",
    });

    expect(updated.accounts.map((account) => account.id)).toEqual([
      a.accountId,
    ]);
  });

  it("rechaza una cuenta de otro Space con 404", async () => {
    const db = forSpace(a.spaceId);
    const budget = await createBudget(db, a.spaceId, "EUR", TIMEZONE, {
      name: "Comida",
      period: "MONTHLY",
      amountMinor: "50000",
    });

    await expect(
      updateBudget(db, TIMEZONE, budget.id, { accountIds: [b.accountId] }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("listado y resumen", () => {
  it("oculta los inactivos salvo que se pidan", async () => {
    const db = forSpace(a.spaceId);
    const budget = await createBudget(db, a.spaceId, "EUR", TIMEZONE, {
      name: "Comida",
      period: "MONTHLY",
      amountMinor: "50000",
    });
    await updateBudget(db, TIMEZONE, budget.id, { isActive: false });

    expect(await listBudgets(db, TIMEZONE)).toHaveLength(0);
    expect(
      await listBudgets(db, TIMEZONE, { includeInactive: true }),
    ).toHaveLength(1);
  });

  it("el resumen cuenta cuántos están pasados y cuántos cerca", async () => {
    const db = forSpace(a.spaceId);
    const today = todayInFixture();

    await spend(a, 62_000n, today, a.parentCategoryId);
    await spend(a, 42_000n, today, a.otherCategoryId);

    await createBudget(db, a.spaceId, "EUR", TIMEZONE, {
      name: "Comida",
      period: "MONTHLY",
      amountMinor: "50000",
      categoryId: a.parentCategoryId,
    });
    await createBudget(db, a.spaceId, "EUR", TIMEZONE, {
      name: "Transporte",
      period: "MONTHLY",
      amountMinor: "50000",
      categoryId: a.otherCategoryId,
    });

    const summary = await budgetSummary(db, TIMEZONE, "EUR");

    expect(summary.total).toBe(2);
    expect(summary.overBudget).toBe(1);
    expect(summary.nearLimit).toBe(1);
    expect(summary.totalSpent.amountMinor).toBe("104000");
  });
});

describe("aislamiento entre Spaces", () => {
  it("el listado solo trae los propios", async () => {
    await createBudget(forSpace(a.spaceId), a.spaceId, "EUR", TIMEZONE, {
      name: "De A",
      period: "MONTHLY",
      amountMinor: "50000",
    });
    await createBudget(forSpace(b.spaceId), b.spaceId, "EUR", TIMEZONE, {
      name: "De B",
      period: "MONTHLY",
      amountMinor: "50000",
    });

    const budgets = await listBudgets(forSpace(a.spaceId), TIMEZONE);
    expect(budgets).toHaveLength(1);
    expect(budgets[0]?.name).toBe("De A");
  });

  it("un presupuesto ajeno da 404 por id", async () => {
    const ajeno = await createBudget(
      forSpace(b.spaceId),
      b.spaceId,
      "EUR",
      TIMEZONE,
      { name: "De B", period: "MONTHLY", amountMinor: "50000" },
    );

    await expect(
      getBudget(forSpace(a.spaceId), TIMEZONE, ajeno.id),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    await expect(
      updateBudget(forSpace(a.spaceId), TIMEZONE, ajeno.id, { name: "Robado" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    await expect(
      deleteBudget(forSpace(a.spaceId), ajeno.id),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("el gasto de un Space no cuenta en el presupuesto del otro", async () => {
    const today = todayInFixture();
    await spend(a, 30_000n, today, a.parentCategoryId);
    await spend(b, 90_000n, today, b.parentCategoryId);

    const budget = await createBudget(
      forSpace(a.spaceId),
      a.spaceId,
      "EUR",
      TIMEZONE,
      {
        name: "Comida",
        period: "MONTHLY",
        amountMinor: "100000",
        categoryId: a.parentCategoryId,
      },
    );

    expect(budget.spent.amountMinor).toBe("30000");
  });
});

/**
 * "Hoy" en la timezone de las fixtures. Los tests cargan gastos en el período
 * actual, así que no pueden usar una fecha fija: al mes siguiente dejarían de
 * caer dentro del período y empezarían a fallar solos.
 */
const todayInFixture = (): string =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
