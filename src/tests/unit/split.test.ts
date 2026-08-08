import { describe, expect, it } from "vitest";

import { money } from "@/shared/money";
import {
  memberBalances,
  settleUp,
  splitByPercentage,
  splitEvenly,
  validateShares,
  type MemberFlow,
} from "@/shared/split";

/**
 * Reparto de gastos.
 *
 * Lo que se cuida acá es que no se pierda ni se invente un céntimo: al
 * repartir, al netear y al saldar. Entre personas, un céntimo de diferencia se
 * nota más que en cualquier otro sitio de la app — alguien lo va a revisar a
 * mano.
 */

const EUR = (amountMinor: bigint) => money(amountMinor, "EUR");

const unwrap = (result: ReturnType<typeof splitEvenly>) => {
  if (!result.ok) throw new Error(`esperaba ok, vino ${result.error}`);
  return result.shares;
};

const sum = (shares: readonly { amountMinor: bigint }[]): bigint =>
  shares.reduce((acc, share) => acc + share.amountMinor, 0n);

describe("reparto en partes iguales", () => {
  it("reparte exacto cuando divide", () => {
    const shares = unwrap(splitEvenly(EUR(12_000n), ["a", "b"]));
    expect(shares.map((s) => s.amountMinor)).toEqual([6000n, 6000n]);
  });

  it("no pierde el céntimo que sobra", () => {
    // 10,00 € entre 3: la división normal daría 3,33 tres veces y perdería 1.
    const shares = unwrap(splitEvenly(EUR(1000n), ["a", "b", "c"]));

    expect(shares.map((s) => s.amountMinor)).toEqual([334n, 333n, 333n]);
    expect(sum(shares)).toBe(1000n);
  });

  it("la suma cuadra para cualquier cantidad de personas", () => {
    for (let people = 1; people <= 9; people += 1) {
      const ids = Array.from({ length: people }, (_u, i) => `u${String(i)}`);
      const shares = unwrap(splitEvenly(EUR(9_999n), ids));
      expect(sum(shares)).toBe(9_999n);
    }
  });

  it("rechaza una lista vacía o con repetidos", () => {
    expect(splitEvenly(EUR(1000n), []).ok).toBe(false);
    expect(splitEvenly(EUR(1000n), ["a", "a"]).ok).toBe(false);
  });

  it("rechaza repartir cero o menos", () => {
    expect(splitEvenly(EUR(0n), ["a"]).ok).toBe(false);
    expect(splitEvenly(EUR(-100n), ["a"]).ok).toBe(false);
  });
});

describe("reparto por porcentaje", () => {
  it("reparte según los pesos", () => {
    const result = splitByPercentage(EUR(10_000n), [
      { userId: "a", bps: 7000 },
      { userId: "b", bps: 3000 },
    ]);

    expect(unwrap(result).map((s) => s.amountMinor)).toEqual([7000n, 3000n]);
  });

  it("el resto del redondeo va a la primera parte", () => {
    // Tres partes de 33,33 % de 10,00 € darían 9,99 sin esto.
    const result = splitByPercentage(EUR(1000n), [
      { userId: "a", bps: 3334 },
      { userId: "b", bps: 3333 },
      { userId: "c", bps: 3333 },
    ]);

    const shares = unwrap(result);
    expect(sum(shares)).toBe(1000n);
  });

  it("exige que los porcentajes sumen 100 %", () => {
    expect(
      splitByPercentage(EUR(1000n), [
        { userId: "a", bps: 5000 },
        { userId: "b", bps: 4000 },
      ]).ok,
    ).toBe(false);
  });

  it("rechaza un peso de cero o negativo", () => {
    expect(
      splitByPercentage(EUR(1000n), [
        { userId: "a", bps: 10_000 },
        { userId: "b", bps: 0 },
      ]).ok,
    ).toBe(false);
  });
});

describe("reparto a mano", () => {
  it("acepta el que cuadra", () => {
    const result = validateShares(EUR(1000n), [
      { userId: "a", amountMinor: 700n },
      { userId: "b", amountMinor: 300n },
    ]);
    expect(result.ok).toBe(true);
  });

  it("rechaza el que no cuadra, en vez de corregirlo", () => {
    // Ajustar en silencio cambiaría lo que la persona quiso repartir.
    const short = validateShares(EUR(1000n), [
      { userId: "a", amountMinor: 700n },
      { userId: "b", amountMinor: 200n },
    ]);
    expect(short).toEqual({ ok: false, error: "SUM_MISMATCH" });

    const over = validateShares(EUR(1000n), [
      { userId: "a", amountMinor: 700n },
      { userId: "b", amountMinor: 400n },
    ]);
    expect(over).toEqual({ ok: false, error: "SUM_MISMATCH" });
  });

  it("rechaza partes de cero y usuarios repetidos", () => {
    expect(
      validateShares(EUR(1000n), [
        { userId: "a", amountMinor: 1000n },
        { userId: "b", amountMinor: 0n },
      ]).ok,
    ).toBe(false);

    expect(
      validateShares(EUR(1000n), [
        { userId: "a", amountMinor: 500n },
        { userId: "a", amountMinor: 500n },
      ]).ok,
    ).toBe(false);
  });
});

describe("saldos", () => {
  const flows: MemberFlow[] = [
    // Rodrigo puso 120 y le tocaban 60.
    { userId: "rodrigo", paidMinor: 12_000n, owedMinor: 6000n },
    // Ana no puso nada y le tocaban 60.
    { userId: "ana", paidMinor: 0n, owedMinor: 6000n },
  ];

  it("calcula quién debe y a quién le deben", () => {
    const balances = memberBalances(flows, []);

    expect(balances.find((b) => b.userId === "rodrigo")?.netMinor).toBe(6000n);
    expect(balances.find((b) => b.userId === "ana")?.netMinor).toBe(-6000n);
  });

  it("la suma de los saldos es SIEMPRE cero", () => {
    // Es la comprobación de que no se inventó ni se perdió plata.
    const balances = memberBalances(flows, []);
    expect(balances.reduce((acc, b) => acc + b.netMinor, 0n)).toBe(0n);
  });

  it("un saldado cancela lo que se debía", () => {
    const balances = memberBalances(flows, [
      { fromUserId: "ana", toUserId: "rodrigo", amountMinor: 6000n },
    ]);

    expect(balances.every((b) => b.netMinor === 0n)).toBe(true);
  });

  it("un saldado parcial deja el resto", () => {
    const balances = memberBalances(flows, [
      { fromUserId: "ana", toUserId: "rodrigo", amountMinor: 2000n },
    ]);

    expect(balances.find((b) => b.userId === "ana")?.netMinor).toBe(-4000n);
    expect(balances.find((b) => b.userId === "rodrigo")?.netMinor).toBe(4000n);
  });

  it("ordena de quien más debe a quien más le deben", () => {
    const balances = memberBalances(
      [
        { userId: "a", paidMinor: 10_000n, owedMinor: 0n },
        { userId: "b", paidMinor: 0n, owedMinor: 7000n },
        { userId: "c", paidMinor: 0n, owedMinor: 3000n },
      ],
      [],
    );

    expect(balances.map((b) => b.userId)).toEqual(["b", "c", "a"]);
  });

  it("conserva lo puesto y lo que tocaba, no solo el neto", () => {
    const balances = memberBalances(flows, []);
    const rodrigo = balances.find((b) => b.userId === "rodrigo");

    // Sin esto la pantalla no puede explicar de dónde sale el número.
    expect(rodrigo?.paidMinor).toBe(12_000n);
    expect(rodrigo?.owedMinor).toBe(6000n);
  });
});

describe("saldar con el mínimo de pagos", () => {
  it("dos personas, un pago", () => {
    const payments = settleUp([
      { userId: "a", paidMinor: 0n, owedMinor: 0n, netMinor: 6000n },
      { userId: "b", paidMinor: 0n, owedMinor: 0n, netMinor: -6000n },
    ]);

    expect(payments).toEqual([
      { fromUserId: "b", toUserId: "a", amountMinor: 6000n },
    ]);
  });

  it("cuatro personas con deudas cruzadas: tres pagos, no seis", () => {
    const payments = settleUp([
      { userId: "a", paidMinor: 0n, owedMinor: 0n, netMinor: 10_000n },
      { userId: "b", paidMinor: 0n, owedMinor: 0n, netMinor: 5000n },
      { userId: "c", paidMinor: 0n, owedMinor: 0n, netMinor: -9000n },
      { userId: "d", paidMinor: 0n, owedMinor: 0n, netMinor: -6000n },
    ]);

    // Con N personas, N−1 pagos como mucho.
    expect(payments.length).toBeLessThanOrEqual(3);
    expect(payments.reduce((acc, p) => acc + p.amountMinor, 0n)).toBe(15_000n);
  });

  it("los pagos dejan a todo el mundo en cero", () => {
    const balances = [
      { userId: "a", paidMinor: 0n, owedMinor: 0n, netMinor: 10_000n },
      { userId: "b", paidMinor: 0n, owedMinor: 0n, netMinor: 5000n },
      { userId: "c", paidMinor: 0n, owedMinor: 0n, netMinor: -9000n },
      { userId: "d", paidMinor: 0n, owedMinor: 0n, netMinor: -6000n },
    ];

    const after = new Map(balances.map((b) => [b.userId, b.netMinor]));
    for (const payment of settleUp(balances)) {
      after.set(
        payment.fromUserId,
        (after.get(payment.fromUserId) ?? 0n) + payment.amountMinor,
      );
      after.set(
        payment.toUserId,
        (after.get(payment.toUserId) ?? 0n) - payment.amountMinor,
      );
    }

    expect([...after.values()].every((value) => value === 0n)).toBe(true);
  });

  it("sin deudas no hay pagos", () => {
    expect(
      settleUp([
        { userId: "a", paidMinor: 0n, owedMinor: 0n, netMinor: 0n },
        { userId: "b", paidMinor: 0n, owedMinor: 0n, netMinor: 0n },
      ]),
    ).toEqual([]);
  });

  it("nadie se paga a sí mismo", () => {
    const payments = settleUp([
      { userId: "a", paidMinor: 0n, owedMinor: 0n, netMinor: 3000n },
      { userId: "b", paidMinor: 0n, owedMinor: 0n, netMinor: -3000n },
    ]);

    expect(payments.every((p) => p.fromUserId !== p.toUserId)).toBe(true);
  });
});
