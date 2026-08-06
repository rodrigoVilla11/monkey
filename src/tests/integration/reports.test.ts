import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { forSpace } from "@/server/db/scoped";
import {
  categoryReport,
  comparisonReport,
  memberReport,
  monthlyReport,
} from "@/server/services/reports";

import { disconnect, resetDatabase, testDb } from "./helpers/db";

/**
 * Reportes contra Postgres real.
 *
 * Lo que importa acá y no se puede probar sin base: que el SQL crudo de
 * `db/raw/reports.ts` agregue bien por mes, que respete el `spaceId` —porque
 * ahí NO llega la extensión de scope— y que el acumulado del cash flow arranque
 * del patrimonio previo y no de cero.
 */

const TIMEZONE = "Europe/Madrid";
const LOCALE = "es-ES";

interface Fixture {
  readonly spaceId: string;
  readonly userId: string;
  readonly secondUserId: string;
  readonly accountId: string;
  readonly parentId: string;
  readonly childId: string;
  readonly otherId: string;
}

let a: Fixture;
let b: Fixture;

const buildFixture = async (label: string): Promise<Fixture> => {
  const user = await testDb.user.create({
    data: {
      email: `${label}-1@reports.test`,
      passwordHash: "hash",
      name: `Rodrigo ${label}`,
      timezone: TIMEZONE,
      locale: LOCALE,
      emailVerifiedAt: new Date(),
    },
  });
  const second = await testDb.user.create({
    data: {
      email: `${label}-2@reports.test`,
      passwordHash: "hash",
      name: `Ana ${label}`,
      timezone: TIMEZONE,
      locale: LOCALE,
      emailVerifiedAt: new Date(),
    },
  });

  const space = await testDb.space.create({
    data: {
      name: `Space ${label}`,
      primaryCurrency: "EUR",
      timezone: TIMEZONE,
      memberships: {
        create: [
          { userId: user.id, role: "OWNER" },
          { userId: second.id, role: "MEMBER" },
        ],
      },
    },
  });

  const db = forSpace(space.id);

  const account = await db.account.create({
    data: {
      spaceId: space.id,
      name: "Cuenta",
      type: "BANK",
      currency: "EUR",
      initialBalanceMinor: 100_000n, // 1.000,00 € de apertura
    },
  });

  const parent = await db.category.create({
    data: { spaceId: space.id, name: "Alimentacion", kind: "EXPENSE" },
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
    secondUserId: second.id,
    accountId: account.id,
    parentId: parent.id,
    childId: child.id,
    otherId: other.id,
  };
};

const tx = async (
  fixture: Fixture,
  options: {
    amountMinor: bigint;
    date: string;
    categoryId?: string | null;
    type?: "INCOME" | "EXPENSE" | "TRANSFER";
    userId?: string;
    transferDirection?: "OUT" | "IN";
    primaryMinor?: bigint;
  },
): Promise<void> => {
  const type = options.type ?? "EXPENSE";

  await forSpace(fixture.spaceId).transaction.create({
    data: {
      spaceId: fixture.spaceId,
      accountId: fixture.accountId,
      categoryId: options.categoryId ?? null,
      createdByUserId: options.userId ?? fixture.userId,
      createdByName: "Autor",
      type,
      amountMinor: options.amountMinor,
      currency: options.primaryMinor === undefined ? "EUR" : "ARS",
      date: new Date(`${options.date}T00:00:00Z`),
      ...(options.primaryMinor !== undefined
        ? {
            amountPrimaryMinor: options.primaryMinor,
            exchangeRateSnapshot: "0.001",
          }
        : {}),
      ...(type === "TRANSFER"
        ? {
            transferGroupId: `g-${String(options.amountMinor)}-${options.date}`,
            transferDirection: options.transferDirection ?? "OUT",
          }
        : {}),
    },
  });
};

const space = (fixture: Fixture) => ({
  spaceId: fixture.spaceId,
  primaryCurrency: "EUR",
});

beforeEach(async () => {
  await resetDatabase();
  a = await buildFixture("a");
  b = await buildFixture("b");
});

afterAll(async () => {
  await resetDatabase();
  await disconnect();
});

describe("evolución mensual y cash flow", () => {
  it("rellena los meses SIN movimientos con ceros", async () => {
    // Si se omitieran, el gráfico uniría dos meses no contiguos y la
    // pendiente mentiría.
    const report = await monthlyReport(space(a), LOCALE, TIMEZONE, 6);

    expect(report.points).toHaveLength(6);
    expect(report.points.every((p) => p.month.length === 7)).toBe(true);
    expect(report.points.at(-1)?.month).toBe(currentMonth());
  });

  it("los meses vienen en orden y sin huecos", async () => {
    const report = await monthlyReport(space(a), LOCALE, TIMEZONE, 4);
    const months = report.points.map((p) => p.month);

    expect([...months].sort()).toEqual(months);
    for (let i = 1; i < months.length; i += 1) {
      expect(monthDistance(months[i - 1] ?? "", months[i] ?? "")).toBe(1);
    }
  });

  it("el acumulado arranca del patrimonio previo, no de cero", async () => {
    // La cuenta abre con 1.000 €. Sin ese punto de partida, la curva daría a
    // entender que el patrimonio nació con el primer mes del gráfico.
    const report = await monthlyReport(space(a), LOCALE, TIMEZONE, 3);

    expect(report.points[0]?.runningBalance.amountMinor).toBe("100000");
  });

  it("el acumulado sigue los movimientos mes a mes", async () => {
    const month = currentMonth();
    await tx(a, { amountMinor: 50_000n, date: `${month}-05`, type: "INCOME" });
    await tx(a, { amountMinor: 20_000n, date: `${month}-10` });

    const report = await monthlyReport(space(a), LOCALE, TIMEZONE, 3);
    const last = report.points.at(-1);

    // 1.000 de apertura + 500 de ingreso − 200 de gasto = 1.300 €
    expect(last?.income.amountMinor).toBe("50000");
    expect(last?.expense.amountMinor).toBe("20000");
    expect(last?.net.amountMinor).toBe("30000");
    expect(last?.runningBalance.amountMinor).toBe("130000");
  });

  it("EXCLUYE las transferencias de ingresos y egresos", async () => {
    const month = currentMonth();
    await tx(a, { amountMinor: 20_000n, date: `${month}-10` });
    await tx(a, {
      amountMinor: 90_000n,
      date: `${month}-11`,
      type: "TRANSFER",
      transferDirection: "OUT",
    });

    const report = await monthlyReport(space(a), LOCALE, TIMEZONE, 2);
    const last = report.points.at(-1);

    expect(last?.expense.amountMinor).toBe("20000");
    expect(last?.income.amountMinor).toBe("0");
  });

  it("promedia solo los meses CON actividad", async () => {
    // Incluir los meses vacíos —anteriores a que se empezara a usar la app—
    // hundiría el promedio y daría una lectura falsa.
    const month = currentMonth();
    await tx(a, { amountMinor: 30_000n, date: `${month}-10` });

    const report = await monthlyReport(space(a), LOCALE, TIMEZONE, 12);

    expect(report.averageExpense.amountMinor).toBe("30000");
  });

  it("suma bien con monedas mezcladas", async () => {
    const month = currentMonth();
    await tx(a, { amountMinor: 10_000n, date: `${month}-10` });
    await tx(a, {
      amountMinor: 1_500_000n,
      date: `${month}-11`,
      primaryMinor: 13_050n,
    });

    const report = await monthlyReport(space(a), LOCALE, TIMEZONE, 2);

    expect(report.points.at(-1)?.expense.amountMinor).toBe("23050");
  });

  it("NO mezcla datos de otro Space", async () => {
    // El SQL crudo no pasa por la extensión de scope: filtra por spaceId a
    // mano, y esto lo verifica.
    const month = currentMonth();
    await tx(a, { amountMinor: 10_000n, date: `${month}-10` });
    await tx(b, { amountMinor: 99_000n, date: `${month}-10` });

    const report = await monthlyReport(space(a), LOCALE, TIMEZONE, 2);

    expect(report.points.at(-1)?.expense.amountMinor).toBe("10000");
    expect(report.points[0]?.runningBalance.amountMinor).toBe("100000");
  });
});

describe("desglose por categoría", () => {
  it("anida las subcategorías bajo su padre y suma el total", async () => {
    const month = currentMonth();
    await tx(a, {
      amountMinor: 10_000n,
      date: `${month}-05`,
      categoryId: a.parentId,
    });
    await tx(a, {
      amountMinor: 15_000n,
      date: `${month}-06`,
      categoryId: a.childId,
    });
    await tx(a, {
      amountMinor: 5_000n,
      date: `${month}-07`,
      categoryId: a.otherId,
    });

    const report = await categoryReport(
      forSpace(a.spaceId),
      space(a),
      `${month}-01`,
      `${month}-28`,
      "EXPENSE",
    );

    const alimentacion = report.items.find((i) => i.name === "Alimentacion");
    expect(alimentacion?.total.amountMinor).toBe("25000");
    expect(alimentacion?.children).toHaveLength(1);
    expect(alimentacion?.children[0]?.name).toBe("Supermercado");
    expect(report.total.amountMinor).toBe("30000");
  });

  it("muestra el padre aunque solo tenga gasto en sus hijas", async () => {
    // El padre no aparece en la consulta si no tiene movimientos propios;
    // sin este manejo, el gasto de la subcategoría desaparecería del reporte.
    const month = currentMonth();
    await tx(a, {
      amountMinor: 15_000n,
      date: `${month}-06`,
      categoryId: a.childId,
    });

    const report = await categoryReport(
      forSpace(a.spaceId),
      space(a),
      `${month}-01`,
      `${month}-28`,
      "EXPENSE",
    );

    const alimentacion = report.items.find((i) => i.name === "Alimentacion");
    expect(alimentacion?.total.amountMinor).toBe("15000");
    expect(alimentacion?.children[0]?.name).toBe("Supermercado");
  });

  it("agrupa lo que no tiene categoría", async () => {
    const month = currentMonth();
    await tx(a, { amountMinor: 7_000n, date: `${month}-05`, categoryId: null });

    const report = await categoryReport(
      forSpace(a.spaceId),
      space(a),
      `${month}-01`,
      `${month}-28`,
      "EXPENSE",
    );

    expect(report.items[0]?.name).toBe("Sin categoría");
    expect(report.items[0]?.categoryId).toBeNull();
  });

  it("los porcentajes suman ~100", async () => {
    const month = currentMonth();
    await tx(a, {
      amountMinor: 30_000n,
      date: `${month}-05`,
      categoryId: a.parentId,
    });
    await tx(a, {
      amountMinor: 10_000n,
      date: `${month}-06`,
      categoryId: a.otherId,
    });

    const report = await categoryReport(
      forSpace(a.spaceId),
      space(a),
      `${month}-01`,
      `${month}-28`,
      "EXPENSE",
    );

    const total = report.items.reduce((sum, item) => sum + item.percentage, 0);
    expect(total).toBeGreaterThanOrEqual(99);
    expect(total).toBeLessThanOrEqual(101);
  });

  it("no ve las categorías del otro Space", async () => {
    const month = currentMonth();
    await tx(b, {
      amountMinor: 99_000n,
      date: `${month}-05`,
      categoryId: b.parentId,
    });

    const report = await categoryReport(
      forSpace(a.spaceId),
      space(a),
      `${month}-01`,
      `${month}-28`,
      "EXPENSE",
    );

    expect(report.items).toHaveLength(0);
    expect(report.total.amountMinor).toBe("0");
  });
});

describe("comparativa mes a mes", () => {
  it("calcula la variación por categoría", async () => {
    const month = currentMonth();
    const previous = previousMonth();

    await tx(a, {
      amountMinor: 10_000n,
      date: `${previous}-10`,
      categoryId: a.parentId,
    });
    await tx(a, {
      amountMinor: 15_000n,
      date: `${month}-10`,
      categoryId: a.parentId,
    });

    const report = await comparisonReport(space(a), `${month}-15`, "EXPENSE");
    const item = report.items.find((i) => i.name === "Alimentacion");

    expect(item?.previous.amountMinor).toBe("10000");
    expect(item?.current.amountMinor).toBe("15000");
    expect(item?.delta.amountMinor).toBe("5000");
    expect(item?.deltaPercentage).toBe(50);
    expect(item?.isNew).toBe(false);
  });

  it("marca las categorías nuevas y no inventa un porcentaje", async () => {
    // Dividir por cero no da "infinito por ciento", da "no comparable".
    const month = currentMonth();
    await tx(a, {
      amountMinor: 15_000n,
      date: `${month}-10`,
      categoryId: a.parentId,
    });

    const report = await comparisonReport(space(a), `${month}-15`, "EXPENSE");
    const item = report.items.find((i) => i.name === "Alimentacion");

    expect(item?.isNew).toBe(true);
    expect(item?.deltaPercentage).toBeNull();
  });

  it("incluye lo que se dejó de gastar", async () => {
    // "Dejaste de gastar en esto" es información, no ausencia de ella.
    const previous = previousMonth();
    await tx(a, {
      amountMinor: 20_000n,
      date: `${previous}-10`,
      categoryId: a.otherId,
    });

    const report = await comparisonReport(
      space(a),
      `${currentMonth()}-15`,
      "EXPENSE",
    );
    const item = report.items.find((i) => i.name === "Transporte");

    expect(item?.current.amountMinor).toBe("0");
    expect(item?.previous.amountMinor).toBe("20000");
    expect(item?.delta.amountMinor).toBe("-20000");
    expect(item?.deltaPercentage).toBe(-100);
  });

  it("ordena por cuánto cambió cada una, sin importar el signo", async () => {
    const month = currentMonth();
    const previous = previousMonth();

    await tx(a, {
      amountMinor: 1_000n,
      date: `${month}-10`,
      categoryId: a.parentId,
    });
    await tx(a, {
      amountMinor: 50_000n,
      date: `${previous}-10`,
      categoryId: a.otherId,
    });

    const report = await comparisonReport(space(a), `${month}-15`, "EXPENSE");

    // Transporte cayó 500 €; Alimentación subió 10 €. Primero el que más cambió.
    expect(report.items[0]?.name).toBe("Transporte");
  });
});

describe("desglose por miembro", () => {
  it("reparte el gasto por autor", async () => {
    const month = currentMonth();
    await tx(a, {
      amountMinor: 30_000n,
      date: `${month}-05`,
      userId: a.userId,
    });
    await tx(a, {
      amountMinor: 10_000n,
      date: `${month}-06`,
      userId: a.secondUserId,
    });

    const report = await memberReport(
      forSpace(a.spaceId),
      space(a),
      `${month}-01`,
      `${month}-28`,
      "EXPENSE",
    );

    expect(report.total.amountMinor).toBe("40000");
    expect(report.items[0]?.name).toBe("Rodrigo a");
    expect(report.items[0]?.total.amountMinor).toBe("30000");
    expect(report.items[0]?.percentage).toBe(75);
    expect(report.items[1]?.percentage).toBe(25);
  });

  it("no cuenta los movimientos del otro Space", async () => {
    const month = currentMonth();
    await tx(a, { amountMinor: 10_000n, date: `${month}-05` });
    await tx(b, { amountMinor: 99_000n, date: `${month}-05` });

    const report = await memberReport(
      forSpace(a.spaceId),
      space(a),
      `${month}-01`,
      `${month}-28`,
      "EXPENSE",
    );

    expect(report.total.amountMinor).toBe("10000");
  });
});

/**
 * Los tests cargan movimientos en el mes en curso. Con una fecha fija dejarían
 * de caer en el período al cambiar el mes y empezarían a fallar solos.
 */
const currentMonth = (): string =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
  })
    .format(new Date())
    .slice(0, 7);

const previousMonth = (): string => {
  const [year = "", month = ""] = currentMonth().split("-");
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, 1));
  date.setUTCMonth(date.getUTCMonth() - 1);
  return date.toISOString().slice(0, 7);
};

const monthDistance = (from: string, to: string): number => {
  const [fy = "", fm = ""] = from.split("-");
  const [ty = "", tm = ""] = to.split("-");
  return (Number(ty) - Number(fy)) * 12 + (Number(tm) - Number(fm));
};
