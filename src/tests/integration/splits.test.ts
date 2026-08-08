import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { forSpace } from "@/server/db/scoped";
import { systemClient } from "@/server/db/system";
import { accountBalances } from "@/server/services/balances";
import { monthlyReport } from "@/server/services/reports";
import {
  clearSplit,
  createSettlement,
  deleteSettlement,
  getSplit,
  setSplit,
  splitSummary,
} from "@/server/services/splits";
import type { SetSplitRequest } from "@/shared/contracts/splits";

import { disconnect, resetDatabase, testDb } from "./helpers/db";

/**
 * Reparto de gastos contra Postgres real.
 *
 * Lo que más importa acá:
 *
 *  · Repartir no mueve nada: ni saldos, ni gastos del mes, ni patrimonio. Es
 *    una anotación sobre un gasto que ya existía.
 *  · La suma de los saldos es SIEMPRE cero. Es la comprobación de que no se
 *    inventó ni se perdió plata entre personas.
 *  · Saldar tampoco genera un movimiento: si lo hiciera, el mes en que se
 *    ponen al día parecería el mes de un gasto enorme.
 */

const TIMEZONE = "Europe/Madrid";

interface Space {
  readonly spaceId: string;
  readonly rodrigo: string;
  readonly ana: string;
  readonly lucas: string;
  readonly accountId: string;
}

const context = (space: Space) => ({
  spaceId: space.spaceId,
  primaryCurrency: "EUR",
  timezone: TIMEZONE,
});

let counter = 0;

const makeSpace = async (): Promise<Space> => {
  counter += 1;
  const label = counter.toString().padStart(3, "0");

  const users = await Promise.all(
    ["rodrigo", "ana", "lucas"].map((name) =>
      testDb.user.create({
        data: {
          email: `${name}-split-${label}@monkey.test`,
          passwordHash: "hash",
          name: name[0]!.toUpperCase() + name.slice(1),
          timezone: TIMEZONE,
          locale: "es-ES",
          emailVerifiedAt: new Date(),
        },
      }),
    ),
  );

  const [rodrigo, ana, lucas] = users as [
    (typeof users)[0],
    (typeof users)[0],
    (typeof users)[0],
  ];

  const space = await testDb.space.create({
    data: {
      name: `Casa ${label}`,
      primaryCurrency: "EUR",
      timezone: TIMEZONE,
      memberships: {
        create: [
          { userId: rodrigo.id, role: "OWNER" },
          { userId: ana.id, role: "MEMBER" },
          { userId: lucas.id, role: "MEMBER" },
        ],
      },
    },
  });

  const account = await forSpace(space.id).account.create({
    data: {
      spaceId: space.id,
      name: "Común",
      type: "BANK",
      currency: "EUR",
      initialBalanceMinor: 1_000_000n,
    },
  });

  return {
    spaceId: space.id,
    rodrigo: rodrigo.id,
    ana: ana.id,
    lucas: lucas.id,
    accountId: account.id,
  };
};

const addExpense = async (
  space: Space,
  amountMinor: bigint,
  description = "Cena",
): Promise<string> => {
  const created = await forSpace(space.spaceId).transaction.create({
    data: {
      spaceId: space.spaceId,
      accountId: space.accountId,
      createdByUserId: space.rodrigo,
      createdByName: "Rodrigo",
      type: "EXPENSE",
      amountMinor,
      currency: "EUR",
      date: new Date("2026-08-01T00:00:00Z"),
      description,
    },
    select: { id: true },
  });
  return created.id;
};

const split = (
  space: Space,
  transactionId: string,
  input: SetSplitRequest,
): Promise<void> =>
  systemClient().$transaction(async (tx) => {
    await setSplit(
      forSpace(space.spaceId),
      tx,
      context(space),
      transactionId,
      input,
    );
  });

const settle = (
  space: Space,
  input: { fromUserId: string; toUserId: string; amountMinor: string },
): Promise<string> =>
  systemClient().$transaction(async (tx) =>
    createSettlement(
      forSpace(space.spaceId),
      tx,
      context(space),
      { userId: space.rodrigo },
      input,
    ),
  );

const netOf = (
  summary: Awaited<ReturnType<typeof splitSummary>>,
  userId: string,
): bigint =>
  BigInt(
    summary.balances.find((b) => b.userId === userId)?.net.amountMinor ?? "0",
  );

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await disconnect();
});

describe("repartir no mueve nada", () => {
  it("no toca los saldos de las cuentas", async () => {
    const space = await makeSpace();
    const id = await addExpense(space, 12_000n);

    const before = await accountBalances(forSpace(space.spaceId));

    await split(space, id, {
      paidByUserId: space.rodrigo,
      mode: "EVEN",
      participants: [{ userId: space.rodrigo }, { userId: space.ana }],
    });

    const after = await accountBalances(forSpace(space.spaceId));
    expect(after.get(space.accountId)?.balanceMinor).toBe(
      before.get(space.accountId)?.balanceMinor,
    );
  });

  it("no cambia el gasto del mes ni el patrimonio", async () => {
    const space = await makeSpace();
    const id = await addExpense(space, 12_000n);

    const before = await monthlyReport(context(space), "es-ES", TIMEZONE, 3);

    await split(space, id, {
      paidByUserId: space.rodrigo,
      mode: "EVEN",
      participants: [{ userId: space.rodrigo }, { userId: space.ana }],
    });

    const after = await monthlyReport(context(space), "es-ES", TIMEZONE, 3);

    // El gasto ya estaba cargado; repartirlo solo anota de quién era.
    expect(after.points.map((p) => p.expense.amountMinor)).toEqual(
      before.points.map((p) => p.expense.amountMinor),
    );
    expect(after.points.at(-1)?.runningBalance.amountMinor).toBe(
      before.points.at(-1)?.runningBalance.amountMinor,
    );
  });

  it("no crea movimientos nuevos", async () => {
    const space = await makeSpace();
    const id = await addExpense(space, 12_000n);

    await split(space, id, {
      paidByUserId: space.rodrigo,
      mode: "EVEN",
      participants: [{ userId: space.rodrigo }, { userId: space.ana }],
    });

    expect(
      await testDb.transaction.count({ where: { spaceId: space.spaceId } }),
    ).toBe(1);
  });
});

describe("modos de reparto", () => {
  it("partes iguales, sin perder el céntimo que sobra", async () => {
    const space = await makeSpace();
    const id = await addExpense(space, 1000n);

    await split(space, id, {
      paidByUserId: space.rodrigo,
      mode: "EVEN",
      participants: [
        { userId: space.rodrigo },
        { userId: space.ana },
        { userId: space.lucas },
      ],
    });

    const result = await getSplit(forSpace(space.spaceId), id);
    const amounts = result.shares.map((s) => BigInt(s.amount.amountMinor));

    expect(amounts.reduce((a, b) => a + b, 0n)).toBe(1000n);
    expect(amounts.sort()).toEqual([333n, 333n, 334n]);
  });

  it("por porcentaje", async () => {
    const space = await makeSpace();
    const id = await addExpense(space, 10_000n);

    await split(space, id, {
      paidByUserId: space.rodrigo,
      mode: "PERCENTAGE",
      participants: [
        { userId: space.rodrigo, bps: 7000 },
        { userId: space.ana, bps: 3000 },
      ],
    });

    const result = await getSplit(forSpace(space.spaceId), id);
    const byUser = new Map(
      result.shares.map((s) => [s.userId, s.amount.amountMinor]),
    );

    expect(byUser.get(space.rodrigo)).toBe("7000");
    expect(byUser.get(space.ana)).toBe("3000");
  });

  it("importes exactos", async () => {
    const space = await makeSpace();
    const id = await addExpense(space, 10_000n);

    await split(space, id, {
      paidByUserId: space.rodrigo,
      mode: "EXACT",
      participants: [
        { userId: space.rodrigo, amountMinor: "6500" },
        { userId: space.ana, amountMinor: "3500" },
      ],
    });

    const result = await getSplit(forSpace(space.spaceId), id);
    expect(
      result.shares.reduce((acc, s) => acc + BigInt(s.amount.amountMinor), 0n),
    ).toBe(10_000n);
  });

  it("rechaza importes exactos que no suman, en vez de corregirlos", async () => {
    const space = await makeSpace();
    const id = await addExpense(space, 10_000n);

    await expect(
      split(space, id, {
        paidByUserId: space.rodrigo,
        mode: "EXACT",
        participants: [
          { userId: space.rodrigo, amountMinor: "6000" },
          { userId: space.ana, amountMinor: "3000" },
        ],
      }),
    ).rejects.toThrow(/no suman el importe/);

    // Y no quedó nada a medias.
    const result = await getSplit(forSpace(space.spaceId), id);
    expect(result.shares).toHaveLength(0);
  });

  it("reemplaza el reparto entero, no lo mezcla", async () => {
    const space = await makeSpace();
    const id = await addExpense(space, 12_000n);

    await split(space, id, {
      paidByUserId: space.rodrigo,
      mode: "EVEN",
      participants: [
        { userId: space.rodrigo },
        { userId: space.ana },
        { userId: space.lucas },
      ],
    });

    await split(space, id, {
      paidByUserId: space.ana,
      mode: "EVEN",
      participants: [{ userId: space.rodrigo }, { userId: space.ana }],
    });

    const result = await getSplit(forSpace(space.spaceId), id);

    // Mezclar dejaría cinco partes que no suman el importe.
    expect(result.shares).toHaveLength(2);
    expect(
      result.shares.reduce((acc, s) => acc + BigInt(s.amount.amountMinor), 0n),
    ).toBe(12_000n);
    expect(result.paidBy?.userId).toBe(space.ana);
  });

  it("solo se reparten gastos", async () => {
    const space = await makeSpace();

    const income = await forSpace(space.spaceId).transaction.create({
      data: {
        spaceId: space.spaceId,
        accountId: space.accountId,
        createdByName: "Rodrigo",
        type: "INCOME",
        amountMinor: 10_000n,
        currency: "EUR",
        date: new Date("2026-08-01T00:00:00Z"),
      },
      select: { id: true },
    });

    await expect(
      split(space, income.id, {
        paidByUserId: space.rodrigo,
        mode: "EVEN",
        participants: [{ userId: space.rodrigo }],
      }),
    ).rejects.toThrow(/Solo se pueden repartir gastos/);
  });

  it("un participante que no es miembro da 404", async () => {
    const space = await makeSpace();
    const other = await makeSpace();
    const id = await addExpense(space, 10_000n);

    await expect(
      split(space, id, {
        paidByUserId: space.rodrigo,
        mode: "EVEN",
        participants: [{ userId: space.rodrigo }, { userId: other.rodrigo }],
      }),
    ).rejects.toThrow(/no es miembro/);
  });

  it("quitar el reparto deja el gasto como estaba", async () => {
    const space = await makeSpace();
    const id = await addExpense(space, 12_000n);

    await split(space, id, {
      paidByUserId: space.rodrigo,
      mode: "EVEN",
      participants: [{ userId: space.rodrigo }, { userId: space.ana }],
    });

    await systemClient().$transaction(async (tx) => {
      await clearSplit(forSpace(space.spaceId), tx, space.spaceId, id);
    });

    const result = await getSplit(forSpace(space.spaceId), id);
    expect(result.shares).toHaveLength(0);
    expect(result.paidBy).toBeNull();
    expect(result.total.amountMinor).toBe("12000");
  });
});

describe("quién le debe a quién", () => {
  it("el que puso y no consumió todo queda acreedor", async () => {
    const space = await makeSpace();
    const id = await addExpense(space, 12_000n);

    await split(space, id, {
      paidByUserId: space.rodrigo,
      mode: "EVEN",
      participants: [{ userId: space.rodrigo }, { userId: space.ana }],
    });

    const summary = await splitSummary(forSpace(space.spaceId), context(space));

    expect(netOf(summary, space.rodrigo)).toBe(6000n);
    expect(netOf(summary, space.ana)).toBe(-6000n);
  });

  it("la suma de los saldos es SIEMPRE cero", async () => {
    const space = await makeSpace();

    // Varios gastos, distintos pagadores y distintos repartos.
    const a = await addExpense(space, 12_000n, "Cena");
    const b = await addExpense(space, 7_500n, "Súper");
    const c = await addExpense(space, 3_333n, "Taxi");

    await split(space, a, {
      paidByUserId: space.rodrigo,
      mode: "EVEN",
      participants: [
        { userId: space.rodrigo },
        { userId: space.ana },
        { userId: space.lucas },
      ],
    });
    await split(space, b, {
      paidByUserId: space.ana,
      mode: "PERCENTAGE",
      participants: [
        { userId: space.ana, bps: 6000 },
        { userId: space.lucas, bps: 4000 },
      ],
    });
    await split(space, c, {
      paidByUserId: space.lucas,
      mode: "EVEN",
      participants: [{ userId: space.rodrigo }, { userId: space.lucas }],
    });

    const summary = await splitSummary(forSpace(space.spaceId), context(space));
    const total = summary.balances.reduce(
      (acc, balance) => acc + BigInt(balance.net.amountMinor),
      0n,
    );

    // Es LA comprobación de que no se inventó ni se perdió plata.
    expect(total).toBe(0n);
  });

  it("sugiere los pagos mínimos y dejan todo en cero", async () => {
    const space = await makeSpace();
    const a = await addExpense(space, 12_000n);
    const b = await addExpense(space, 6_000n);

    await split(space, a, {
      paidByUserId: space.rodrigo,
      mode: "EVEN",
      participants: [
        { userId: space.rodrigo },
        { userId: space.ana },
        { userId: space.lucas },
      ],
    });
    await split(space, b, {
      paidByUserId: space.ana,
      mode: "EVEN",
      participants: [
        { userId: space.rodrigo },
        { userId: space.ana },
        { userId: space.lucas },
      ],
    });

    const summary = await splitSummary(forSpace(space.spaceId), context(space));

    // Con 3 personas, 2 pagos como mucho.
    expect(summary.suggested.length).toBeLessThanOrEqual(2);

    const after = new Map(
      summary.balances.map((b2) => [b2.userId, BigInt(b2.net.amountMinor)]),
    );
    for (const payment of summary.suggested) {
      after.set(
        payment.from.userId,
        (after.get(payment.from.userId) ?? 0n) +
          BigInt(payment.amount.amountMinor),
      );
      after.set(
        payment.to.userId,
        (after.get(payment.to.userId) ?? 0n) -
          BigInt(payment.amount.amountMinor),
      );
    }

    expect([...after.values()].every((value) => value === 0n)).toBe(true);
  });

  it("un gasto sin reparto no entra en el saldo", async () => {
    const space = await makeSpace();
    await addExpense(space, 50_000n, "Sin repartir");

    const summary = await splitSummary(forSpace(space.spaceId), context(space));

    expect(summary.splitCount).toBe(0);
    expect(summary.balances).toHaveLength(0);
    expect(summary.suggested).toHaveLength(0);
  });

  it("conserva lo puesto y lo que tocaba, no solo el neto", async () => {
    const space = await makeSpace();
    const id = await addExpense(space, 12_000n);

    await split(space, id, {
      paidByUserId: space.rodrigo,
      mode: "EVEN",
      participants: [{ userId: space.rodrigo }, { userId: space.ana }],
    });

    const summary = await splitSummary(forSpace(space.spaceId), context(space));
    const rodrigo = summary.balances.find((b) => b.userId === space.rodrigo);

    // Sin esto la pantalla no puede explicar de dónde sale el número.
    expect(rodrigo?.paid.amountMinor).toBe("12000");
    expect(rodrigo?.owed.amountMinor).toBe("6000");
  });
});

describe("saldar", () => {
  const setup = async (): Promise<Space> => {
    const space = await makeSpace();
    const id = await addExpense(space, 12_000n);

    await split(space, id, {
      paidByUserId: space.rodrigo,
      mode: "EVEN",
      participants: [{ userId: space.rodrigo }, { userId: space.ana }],
    });

    return space;
  };

  it("cancela lo que se debía", async () => {
    const space = await setup();

    await settle(space, {
      fromUserId: space.ana,
      toUserId: space.rodrigo,
      amountMinor: "6000",
    });

    const summary = await splitSummary(forSpace(space.spaceId), context(space));

    expect(netOf(summary, space.rodrigo)).toBe(0n);
    expect(netOf(summary, space.ana)).toBe(0n);
    expect(summary.suggested).toHaveLength(0);
  });

  it("un saldado parcial deja el resto", async () => {
    const space = await setup();

    await settle(space, {
      fromUserId: space.ana,
      toUserId: space.rodrigo,
      amountMinor: "2000",
    });

    const summary = await splitSummary(forSpace(space.spaceId), context(space));
    expect(netOf(summary, space.ana)).toBe(-4000n);
  });

  it("NO genera ningún movimiento", async () => {
    const space = await setup();

    const before = await monthlyReport(context(space), "es-ES", TIMEZONE, 3);

    await settle(space, {
      fromUserId: space.ana,
      toUserId: space.rodrigo,
      amountMinor: "6000",
    });

    const after = await monthlyReport(context(space), "es-ES", TIMEZONE, 3);

    // Si lo generara, el mes en que se ponen al día parecería el mes de un
    // gasto enorme.
    expect(
      await testDb.transaction.count({ where: { spaceId: space.spaceId } }),
    ).toBe(1);
    expect(after.points.map((p) => p.expense.amountMinor)).toEqual(
      before.points.map((p) => p.expense.amountMinor),
    );
  });

  it("deshacerlo devuelve el saldo a lo que era", async () => {
    const space = await setup();

    const id = await settle(space, {
      fromUserId: space.ana,
      toUserId: space.rodrigo,
      amountMinor: "6000",
    });

    await systemClient().$transaction(async (tx) => {
      await deleteSettlement(forSpace(space.spaceId), tx, id);
    });

    const summary = await splitSummary(forSpace(space.spaceId), context(space));
    expect(netOf(summary, space.ana)).toBe(-6000n);
  });

  it("aparece en el historial", async () => {
    const space = await setup();

    await settle(space, {
      fromUserId: space.ana,
      toUserId: space.rodrigo,
      amountMinor: "6000",
    });

    const summary = await splitSummary(forSpace(space.spaceId), context(space));

    expect(summary.settlements).toHaveLength(1);
    expect(summary.settlements[0]?.from.name).toBe("Ana");
    expect(summary.settlements[0]?.to.name).toBe("Rodrigo");
  });

  it("no se puede saldar con alguien de otro Space", async () => {
    const space = await setup();
    const other = await makeSpace();

    await expect(
      settle(space, {
        fromUserId: space.ana,
        toUserId: other.rodrigo,
        amountMinor: "1000",
      }),
    ).rejects.toThrow(/no es miembro/);
  });

  it("la base impide saldarse con uno mismo", async () => {
    const space = await setup();

    await expect(
      forSpace(space.spaceId).settlement.create({
        data: {
          spaceId: space.spaceId,
          fromUserId: space.ana,
          toUserId: space.ana,
          amountMinor: 1000n,
          currency: "EUR",
          date: new Date("2026-08-01T00:00:00Z"),
        },
      }),
    ).rejects.toThrow(/Settlement_distinct_parties/);
  });
});

describe("aislamiento entre Spaces", () => {
  it("no se puede repartir un gasto de otro Space", async () => {
    const mine = await makeSpace();
    const other = await makeSpace();
    const foreign = await addExpense(other, 10_000n);

    await expect(
      split(mine, foreign, {
        paidByUserId: mine.rodrigo,
        mode: "EVEN",
        participants: [{ userId: mine.rodrigo }],
      }),
    ).rejects.toThrow(/No se encontró el movimiento/);
  });

  it("el resumen de un Space ignora los repartos del otro", async () => {
    const mine = await makeSpace();
    const other = await makeSpace();

    const foreign = await addExpense(other, 90_000n);
    await split(other, foreign, {
      paidByUserId: other.rodrigo,
      mode: "EVEN",
      participants: [{ userId: other.rodrigo }, { userId: other.ana }],
    });

    const summary = await splitSummary(forSpace(mine.spaceId), context(mine));

    expect(summary.splitCount).toBe(0);
    expect(summary.balances).toHaveLength(0);
  });

  it("no se puede borrar el saldado de otro Space", async () => {
    const mine = await makeSpace();
    const other = await makeSpace();

    const id = await settle(other, {
      fromUserId: other.ana,
      toUserId: other.rodrigo,
      amountMinor: "1000",
    });

    await expect(
      systemClient().$transaction(async (tx) => {
        await deleteSettlement(forSpace(mine.spaceId), tx, id);
      }),
    ).rejects.toThrow(/No se encontró el saldado/);
  });

  it("la FK compuesta impide un reparto que apunte a otro Space", async () => {
    const mine = await makeSpace();
    const other = await makeSpace();
    const foreign = await addExpense(other, 10_000n);

    // Se fuerza a mano lo que el service impide: la base también lo rechaza.
    await expect(
      testDb.transactionSplit.create({
        data: {
          spaceId: mine.spaceId,
          transactionId: foreign,
          userId: mine.rodrigo,
          amountMinor: 1000n,
        },
      }),
    ).rejects.toThrow();
  });
});
