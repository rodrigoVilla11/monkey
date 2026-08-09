import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { forSpace } from "@/server/db/scoped";
import { systemClient } from "@/server/db/system";
import { accountBalances } from "@/server/services/balances";
import { monthlyReport } from "@/server/services/reports";
import {
  addContribution,
  createSavingsGoal,
  goalReminders,
  deleteSavingsGoal,
  getSavingsGoal,
  listSavingsGoals,
  removeContribution,
  updateSavingsGoal,
} from "@/server/services/savings";

import { disconnect, resetDatabase, testDb } from "./helpers/db";

/**
 * Metas de ahorro contra Postgres real.
 *
 * El test que más importa de este archivo es que **aportar no gasta**: ni toca
 * los saldos, ni aparece en el resumen del mes, ni baja el patrimonio. Apartar
 * plata no es perderla, y un módulo de ahorro que haga bajar el patrimonio al
 * ahorrar está roto de raíz.
 */

const TIMEZONE = "Europe/Madrid";

interface Space {
  readonly spaceId: string;
  readonly accountId: string;
  readonly savingsId: string;
  readonly primaryCurrency: string;
}

let counter = 0;

const makeSpace = async (primaryCurrency = "EUR"): Promise<Space> => {
  counter += 1;
  const label = counter.toString().padStart(3, "0");

  const user = await testDb.user.create({
    data: {
      email: `savings-${label}@monkey.test`,
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
      name: "Corriente",
      type: "BANK",
      currency: primaryCurrency,
      initialBalanceMinor: 500_000n,
    },
  });

  const savings = await db.account.create({
    data: {
      spaceId: space.id,
      name: "Ahorro",
      type: "BANK",
      currency: primaryCurrency,
      initialBalanceMinor: 0n,
    },
  });

  return {
    spaceId: space.id,
    accountId: account.id,
    savingsId: savings.id,
    primaryCurrency,
  };
};

const context = (space: Space) => ({
  spaceId: space.spaceId,
  primaryCurrency: space.primaryCurrency,
});

const addGoal = (
  space: Space,
  over: Record<string, unknown> = {},
): Promise<string> =>
  systemClient().$transaction(async (tx) =>
    createSavingsGoal(forSpace(space.spaceId), tx, context(space), {
      name: "Viaje",
      targetAmountMinor: "300000",
      ...over,
    }),
  );

const contribute = (
  space: Space,
  goalId: string,
  input: Record<string, unknown>,
): Promise<string> =>
  systemClient().$transaction(async (tx) =>
    addContribution(
      forSpace(space.spaceId),
      tx,
      context(space),
      goalId,
      TIMEZONE,
      input,
    ),
  );

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await disconnect();
});

describe("ahorrar no es gastar", () => {
  it("un aporte no toca los saldos de las cuentas", async () => {
    const space = await makeSpace();
    const goalId = await addGoal(space);

    const before = await accountBalances(forSpace(space.spaceId));

    await contribute(space, goalId, { amountMinor: "50000" });

    const after = await accountBalances(forSpace(space.spaceId));

    expect(after.get(space.accountId)?.balanceMinor).toBe(
      before.get(space.accountId)?.balanceMinor,
    );
    expect(after.get(space.savingsId)?.balanceMinor).toBe(0n);
  });

  it("un aporte no crea ningún movimiento", async () => {
    const space = await makeSpace();
    const goalId = await addGoal(space);

    await contribute(space, goalId, { amountMinor: "50000" });

    const transactions = await testDb.transaction.count({
      where: { spaceId: space.spaceId },
    });
    expect(transactions).toBe(0);
  });

  it("un aporte no aparece como gasto del mes", async () => {
    const space = await makeSpace();
    const goalId = await addGoal(space);

    const before = await monthlyReport(context(space), "es-ES", TIMEZONE, 3);
    await contribute(space, goalId, { amountMinor: "50000" });
    const after = await monthlyReport(context(space), "es-ES", TIMEZONE, 3);

    expect(after.points.map((p) => p.expense.amountMinor)).toEqual(
      before.points.map((p) => p.expense.amountMinor),
    );
    // Y el patrimonio tampoco baja: la plata sigue siendo tuya.
    expect(after.points.at(-1)?.runningBalance.amountMinor).toBe(
      before.points.at(-1)?.runningBalance.amountMinor,
    );
  });
});

describe("progreso", () => {
  it("suma los aportes y calcula lo que falta", async () => {
    const space = await makeSpace();
    const goalId = await addGoal(space);

    await contribute(space, goalId, { amountMinor: "50000" });
    await contribute(space, goalId, { amountMinor: "25000" });

    const goal = await getSavingsGoal(
      forSpace(space.spaceId),
      TIMEZONE,
      goalId,
    );

    expect(goal.saved.amountMinor).toBe("75000");
    expect(goal.remaining.amountMinor).toBe("225000");
    expect(goal.percentage).toBe(25);
    expect(goal.contributionCount).toBe(2);
    expect(goal.achieved).toBe(false);
  });

  it("un retiro resta y puede desmarcar una meta lograda", async () => {
    const space = await makeSpace();
    const goalId = await addGoal(space);

    await contribute(space, goalId, { amountMinor: "300000" });

    let goal = await getSavingsGoal(forSpace(space.spaceId), TIMEZONE, goalId);
    expect(goal.achieved).toBe(true);
    expect(goal.achievedAt).not.toBeNull();

    // Se retira parte: la meta deja de estar lograda.
    await contribute(space, goalId, { amountMinor: "-100000" });

    goal = await getSavingsGoal(forSpace(space.spaceId), TIMEZONE, goalId);
    expect(goal.saved.amountMinor).toBe("200000");
    expect(goal.achieved).toBe(false);
    expect(goal.achievedAt).toBeNull();
  });

  it("subir el objetivo desmarca una meta que ya estaba lograda", async () => {
    const space = await makeSpace();
    const goalId = await addGoal(space);

    await contribute(space, goalId, { amountMinor: "300000" });

    await systemClient().$transaction(async (tx) => {
      await updateSavingsGoal(
        forSpace(space.spaceId),
        tx,
        space.spaceId,
        goalId,
        {
          targetAmountMinor: "500000",
        },
      );
    });

    const goal = await getSavingsGoal(
      forSpace(space.spaceId),
      TIMEZONE,
      goalId,
    );
    expect(goal.achieved).toBe(false);
    expect(goal.achievedAt).toBeNull();
  });

  it("quitar un aporte devuelve el progreso al valor anterior", async () => {
    const space = await makeSpace();
    const goalId = await addGoal(space);

    await contribute(space, goalId, { amountMinor: "50000" });
    const second = await contribute(space, goalId, { amountMinor: "25000" });

    await systemClient().$transaction(async (tx) => {
      await removeContribution(
        forSpace(space.spaceId),
        tx,
        space.spaceId,
        goalId,
        second,
      );
    });

    const goal = await getSavingsGoal(
      forSpace(space.spaceId),
      TIMEZONE,
      goalId,
    );
    expect(goal.saved.amountMinor).toBe("50000");
    expect(goal.contributionCount).toBe(1);
  });
});

describe("aportes vinculados a un movimiento", () => {
  const makeTransfer = async (
    space: Space,
    amountMinor: bigint,
  ): Promise<string> => {
    const created = await forSpace(space.spaceId).transaction.create({
      data: {
        spaceId: space.spaceId,
        accountId: space.savingsId,
        createdByName: "Rodrigo",
        type: "TRANSFER",
        transferGroupId: `grupo-${amountMinor.toString()}`,
        transferDirection: "IN",
        amountMinor,
        currency: space.primaryCurrency,
        date: new Date("2026-08-01T00:00:00Z"),
        description: "A la cuenta de ahorro",
      },
      select: { id: true },
    });
    return created.id;
  };

  it("toma el importe y la fecha del movimiento, no del body", async () => {
    const space = await makeSpace();
    const goalId = await addGoal(space);
    const transactionId = await makeTransfer(space, 80_000n);

    await contribute(space, goalId, {
      transactionId,
      // Se manda una fecha distinta a propósito: tiene que ganar la del
      // movimiento, o el aporte y la transferencia dirían cosas distintas.
      date: "2026-01-01",
    });

    const goal = await getSavingsGoal(
      forSpace(space.spaceId),
      TIMEZONE,
      goalId,
    );

    expect(goal.saved.amountMinor).toBe("80000");
    expect(goal.contributions[0]?.date).toBe("2026-08-01");
    expect(goal.contributions[0]?.transaction?.accountName).toBe("Ahorro");
  });

  it("el mismo movimiento no se puede vincular dos veces", async () => {
    const space = await makeSpace();
    const goalId = await addGoal(space);
    const transactionId = await makeTransfer(space, 80_000n);

    await contribute(space, goalId, { transactionId });

    // Contarlo dos veces diría que ahorraste el doble de lo que hay. Y el
    // mensaje tiene que decir qué pasó: es una condición esperable, no un 500.
    await expect(contribute(space, goalId, { transactionId })).rejects.toThrow(
      /ya está contado en esta meta/,
    );
  });

  it("tampoco en dos metas distintas", async () => {
    const space = await makeSpace();
    const first = await addGoal(space);
    const second = await addGoal(space, { name: "Otra" });
    const transactionId = await makeTransfer(space, 80_000n);

    await contribute(space, first, { transactionId });

    await expect(contribute(space, second, { transactionId })).rejects.toThrow(
      /ya está contado en otra meta/,
    );
  });

  it("el índice de la base sigue siendo la garantía real", async () => {
    // El chequeo previo del service da el mensaje; esto verifica que si dos
    // peticiones simultáneas lo esquivaran, la base igual lo impide.
    const space = await makeSpace();
    const goalId = await addGoal(space);
    const transactionId = await makeTransfer(space, 80_000n);

    await contribute(space, goalId, { transactionId });

    await expect(
      forSpace(space.spaceId).savingsContribution.create({
        data: {
          spaceId: space.spaceId,
          goalId,
          transactionId,
          amountMinor: 80_000n,
          date: new Date("2026-08-01T00:00:00Z"),
        },
      }),
    ).rejects.toThrow(/Unique constraint failed/);
  });

  it("usa el importe ya convertido cuando la meta está en la primaria", async () => {
    const space = await makeSpace("EUR");
    const goalId = await addGoal(space);

    const usd = await forSpace(space.spaceId).account.create({
      data: {
        spaceId: space.spaceId,
        name: "Dólares",
        type: "BANK",
        currency: "USD",
        initialBalanceMinor: 0n,
      },
      select: { id: true },
    });

    const transaction = await forSpace(space.spaceId).transaction.create({
      data: {
        spaceId: space.spaceId,
        accountId: usd.id,
        createdByName: "Rodrigo",
        type: "INCOME",
        amountMinor: 10_000n,
        currency: "USD",
        exchangeRateSnapshot: "0.92",
        amountPrimaryMinor: 9200n,
        date: new Date("2026-08-01T00:00:00Z"),
      },
      select: { id: true },
    });

    await contribute(space, goalId, { transactionId: transaction.id });

    const goal = await getSavingsGoal(
      forSpace(space.spaceId),
      TIMEZONE,
      goalId,
    );
    // 100,00 USD congelados en 92,00 €. No se recotiza nada.
    expect(goal.saved.amountMinor).toBe("9200");
  });

  it("rechaza vincular si no puede resolver la moneda sin inventar", async () => {
    const space = await makeSpace("EUR");
    // Meta en dólares dentro de un Space cuya primaria es el euro.
    const goalId = await addGoal(space, { currency: "USD" });

    const transactionId = await makeTransfer(space, 80_000n); // en EUR

    await expect(contribute(space, goalId, { transactionId })).rejects.toThrow(
      /cargá el aporte con el importe/,
    );
  });
});

describe("borrado", () => {
  it("borrar la meta no toca los movimientos vinculados", async () => {
    const space = await makeSpace();
    const goalId = await addGoal(space);

    const created = await forSpace(space.spaceId).transaction.create({
      data: {
        spaceId: space.spaceId,
        accountId: space.savingsId,
        createdByName: "Rodrigo",
        type: "INCOME",
        amountMinor: 80_000n,
        currency: "EUR",
        date: new Date("2026-08-01T00:00:00Z"),
      },
      select: { id: true },
    });

    await contribute(space, goalId, { transactionId: created.id });

    await systemClient().$transaction(async (tx) => {
      await deleteSavingsGoal(forSpace(space.spaceId), tx, goalId);
    });

    // El movimiento sigue vivo: fue plata que se movió de verdad.
    const survivor = await forSpace(space.spaceId).transaction.findFirst({
      where: { id: created.id },
      select: { id: true },
    });
    expect(survivor).not.toBeNull();

    // Y la meta ya no aparece.
    const goals = await listSavingsGoals(forSpace(space.spaceId), TIMEZONE, {});
    expect(goals).toHaveLength(0);
  });
});

describe("listado", () => {
  it("oculta las logradas salvo que se pidan", async () => {
    const space = await makeSpace();
    const done = await addGoal(space, { name: "Lograda" });
    await addGoal(space, { name: "Pendiente" });

    await contribute(space, done, { amountMinor: "300000" });

    const db = forSpace(space.spaceId);
    const pending = await listSavingsGoals(db, TIMEZONE, {});
    const all = await listSavingsGoals(db, TIMEZONE, { includeAchieved: true });

    expect(pending.map((g) => g.name)).toEqual(["Pendiente"]);
    expect(all).toHaveLength(2);
  });

  it("ordena por urgencia y deja las sin plazo al final", async () => {
    const space = await makeSpace();
    await addGoal(space, { name: "Sin plazo" });
    await addGoal(space, { name: "Lejana", targetDate: "2027-12-31" });
    await addGoal(space, { name: "Urgente", targetDate: "2026-09-01" });

    const goals = await listSavingsGoals(forSpace(space.spaceId), TIMEZONE, {});

    expect(goals.map((g) => g.name)).toEqual([
      "Urgente",
      "Lejana",
      "Sin plazo",
    ]);
  });
});

describe("aislamiento entre Spaces", () => {
  it("no se puede aportar a una meta de otro Space", async () => {
    const mine = await makeSpace();
    const other = await makeSpace();

    const foreign = await addGoal(other);

    await expect(
      contribute(mine, foreign, { amountMinor: "10000" }),
    ).rejects.toThrow(/No se encontró la meta/);
  });

  it("no se puede vincular un movimiento de otro Space", async () => {
    const mine = await makeSpace();
    const other = await makeSpace();

    const goalId = await addGoal(mine);

    const foreign = await forSpace(other.spaceId).transaction.create({
      data: {
        spaceId: other.spaceId,
        accountId: other.accountId,
        createdByName: "Ajeno",
        type: "INCOME",
        amountMinor: 80_000n,
        currency: "EUR",
        date: new Date("2026-08-01T00:00:00Z"),
      },
      select: { id: true },
    });

    // 404 y no 403: confirmar que existe ya sería filtrar.
    await expect(
      contribute(mine, goalId, { transactionId: foreign.id }),
    ).rejects.toThrow(/No se encontró el movimiento/);
  });

  it("las metas de otro Space no aparecen ni se pueden leer", async () => {
    const mine = await makeSpace();
    const other = await makeSpace();

    const foreign = await addGoal(other);

    await expect(
      getSavingsGoal(forSpace(mine.spaceId), TIMEZONE, foreign),
    ).rejects.toThrow(/No se encontró la meta/);

    const goals = await listSavingsGoals(forSpace(mine.spaceId), TIMEZONE, {});
    expect(goals).toHaveLength(0);
  });
});

describe("cómo llegar a la meta", () => {
  /**
   * Un plan arrancado en 2020 ya venció entero, corra el día que corra el
   * test. Las propuestas, en cambio, dependen de cuánto falta para la fecha
   * objetivo, así que de ellas se afirma lo que es cierto siempre: que
   * alcanzan y que terminan a tiempo.
   */
  const plan = {
    amountMinor: "50000",
    frequency: "MONTHLY" as const,
    interval: 1,
    startDate: "2020-01-05",
  };

  it("propone formas de llegar y todas alcanzan a tiempo", async () => {
    const space = await makeSpace();
    const goalId = await addGoal(space, { targetDate: "2099-11-27" });

    const goal = await getSavingsGoal(
      forSpace(space.spaceId),
      TIMEZONE,
      goalId,
    );

    expect(goal.planOptions.length).toBeGreaterThan(0);
    for (const option of goal.planOptions) {
      expect(
        BigInt(option.amount.amountMinor) * BigInt(option.count),
      ).toBeGreaterThanOrEqual(BigInt(goal.remaining.amountMinor));
      expect(option.lastDate <= "2099-11-27").toBe(true);
    }
  });

  it("las propuestas se calculan sobre lo que falta, no sobre el objetivo", async () => {
    const space = await makeSpace();
    const goalId = await addGoal(space, { targetDate: "2099-11-27" });

    const antes = await getSavingsGoal(
      forSpace(space.spaceId),
      TIMEZONE,
      goalId,
    );
    await contribute(space, goalId, { amountMinor: "150000" });
    const despues = await getSavingsGoal(
      forSpace(space.spaceId),
      TIMEZONE,
      goalId,
    );

    const mensualAntes = antes.planOptions.find(
      (o) => o.frequency === "MONTHLY",
    );
    const mensualDespues = despues.planOptions.find(
      (o) => o.frequency === "MONTHLY",
    );

    // Con la mitad juntada, el número propuesto baja.
    expect(BigInt(mensualDespues?.amount.amountMinor ?? "0")).toBeLessThan(
      BigInt(mensualAntes?.amount.amountMinor ?? "0"),
    );
  });

  it("sin fecha objetivo no propone nada", async () => {
    const space = await makeSpace();
    const goalId = await addGoal(space);

    const goal = await getSavingsGoal(
      forSpace(space.spaceId),
      TIMEZONE,
      goalId,
    );
    expect(goal.planOptions).toEqual([]);
  });

  it("guarda la forma elegida y dice cuántos aportes faltan", async () => {
    const space = await makeSpace();
    const goalId = await addGoal(space, { plan });

    const goal = await getSavingsGoal(
      forSpace(space.spaceId),
      TIMEZONE,
      goalId,
    );

    expect(goal.plan?.amount.amountMinor).toBe("50000");
    expect(goal.plan?.description).toBe("Todos los meses el día 5");
    // 3.000 en aportes de 500: seis.
    expect(goal.plan?.remainingContributions).toBe(6);
  });

  it("el atraso es contra lo que ya venció", async () => {
    const space = await makeSpace();
    const goalId = await addGoal(space, { plan });

    await contribute(space, goalId, { amountMinor: "100000" });

    const goal = await getSavingsGoal(
      forSpace(space.spaceId),
      TIMEZONE,
      goalId,
    );

    // Las seis fechas ya pasaron: se esperaba el objetivo entero y hay 1.000.
    expect(goal.plan?.expectedToDate.amountMinor).toBe("300000");
    expect(goal.plan?.behind.amountMinor).toBe("200000");
    expect(goal.plan?.remainingContributions).toBe(4);
  });

  it("se cambia y se saca de una meta que ya existe", async () => {
    const space = await makeSpace();
    const goalId = await addGoal(space);

    await systemClient().$transaction(async (tx) =>
      updateSavingsGoal(forSpace(space.spaceId), tx, space.spaceId, goalId, {
        plan,
      }),
    );
    const conPlan = await getSavingsGoal(
      forSpace(space.spaceId),
      TIMEZONE,
      goalId,
    );
    expect(conPlan.plan?.amount.amountMinor).toBe("50000");

    await systemClient().$transaction(async (tx) =>
      updateSavingsGoal(forSpace(space.spaceId), tx, space.spaceId, goalId, {
        plan: null,
      }),
    );
    const sinPlan = await getSavingsGoal(
      forSpace(space.spaceId),
      TIMEZONE,
      goalId,
    );
    expect(sinPlan.plan).toBeNull();
  });

  it("editar otra cosa no borra el plan", async () => {
    const space = await makeSpace();
    const goalId = await addGoal(space, { plan });

    await systemClient().$transaction(async (tx) =>
      updateSavingsGoal(forSpace(space.spaceId), tx, space.spaceId, goalId, {
        name: "La bici",
      }),
    );

    const goal = await getSavingsGoal(
      forSpace(space.spaceId),
      TIMEZONE,
      goalId,
    );
    expect(goal.name).toBe("La bici");
    expect(goal.plan?.amount.amountMinor).toBe("50000");
  });

  it("la base rechaza medio plan", async () => {
    const space = await makeSpace();
    const goalId = await addGoal(space);

    await expect(
      testDb.$executeRaw`UPDATE "SavingsGoal" SET "planAmountMinor" = 50000 WHERE "id" = ${goalId}`,
    ).rejects.toThrow();
  });
});

describe("recordatorios del inicio", () => {
  const plan = {
    amountMinor: "50000",
    frequency: "MONTHLY" as const,
    interval: 1,
    startDate: "2020-01-05",
  };

  it("solo trae las metas con una forma elegida", async () => {
    const space = await makeSpace();
    await addGoal(space, { name: "Sin plan" });
    await addGoal(space, { name: "Con plan", plan });

    const reminders = await goalReminders(forSpace(space.spaceId), TIMEZONE);

    expect(reminders.map((r) => r.name)).toEqual(["Con plan"]);
    expect(reminders[0]?.amount.amountMinor).toBe("50000");
  });

  it("pone primero lo que ya se debió apartar", async () => {
    const space = await makeSpace();
    // Al día: el plan arranca en el futuro, así que todavía no venció nada.
    await addGoal(space, {
      name: "Al día",
      plan: { ...plan, startDate: "2099-01-05" },
    });
    await addGoal(space, { name: "Atrasada", plan });

    const reminders = await goalReminders(forSpace(space.spaceId), TIMEZONE);

    expect(reminders.map((r) => r.name)).toEqual(["Atrasada", "Al día"]);
  });

  it("una meta alcanzada no recuerda nada", async () => {
    const space = await makeSpace();
    const goalId = await addGoal(space, { name: "Lograda", plan });

    await contribute(space, goalId, { amountMinor: "300000" });

    const reminders = await goalReminders(forSpace(space.spaceId), TIMEZONE);
    expect(reminders).toEqual([]);
  });
});
