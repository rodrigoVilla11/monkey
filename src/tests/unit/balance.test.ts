import { describe, expect, it } from "vitest";

import {
  accountBalance,
  movementSign,
  percentageOf,
  periodTotals,
  signedAmount,
  type BalanceMovement,
} from "@/shared/balance";

const income = (amount: bigint): BalanceMovement => ({
  type: "INCOME",
  amountMinor: amount,
});
const expense = (amount: bigint): BalanceMovement => ({
  type: "EXPENSE",
  amountMinor: amount,
});
const transferOut = (amount: bigint): BalanceMovement => ({
  type: "TRANSFER",
  amountMinor: amount,
  transferDirection: "OUT",
});
const transferIn = (amount: bigint): BalanceMovement => ({
  type: "TRANSFER",
  amountMinor: amount,
  transferDirection: "IN",
});

describe("signo de un movimiento", () => {
  it("un ingreso suma y un gasto resta", () => {
    expect(movementSign(income(100n))).toBe(1n);
    expect(movementSign(expense(100n))).toBe(-1n);
  });

  it("las dos patas de una transferencia van en sentidos opuestos", () => {
    // Comparten el tipo TRANSFER: sin `transferDirection` no habría forma de
    // saber cuál resta y cuál suma.
    expect(movementSign(transferOut(100n))).toBe(-1n);
    expect(movementSign(transferIn(100n))).toBe(1n);
  });

  it("una transferencia sin sentido no afecta el saldo, en vez de adivinar", () => {
    // Un CHECK en la base impide que esta fila exista; si igual apareciera,
    // se prefiere ignorarla a inventarle un signo.
    expect(
      movementSign({
        type: "TRANSFER",
        amountMinor: 100n,
        transferDirection: null,
      }),
    ).toBe(0n);
  });

  it("aplica el signo al importe", () => {
    expect(signedAmount(income(2500n))).toBe(2500n);
    expect(signedAmount(expense(2500n))).toBe(-2500n);
    expect(signedAmount(transferOut(2500n))).toBe(-2500n);
  });
});

describe("saldo de una cuenta", () => {
  it("parte del saldo de apertura", () => {
    expect(accountBalance(100_000n, [])).toBe(100_000n);
  });

  it("suma ingresos y resta gastos", () => {
    const balance = accountBalance(100_000n, [
      income(50_000n),
      expense(20_000n),
      expense(5_000n),
    ]);
    expect(balance).toBe(125_000n);
  });

  it("puede quedar negativo, como una tarjeta de crédito", () => {
    expect(accountBalance(0n, [expense(50_000n)])).toBe(-50_000n);
  });

  it("una transferencia entre dos cuentas propias no cambia el total", () => {
    // Es el invariante que justifica que exista `transferDirection`.
    const origen = accountBalance(100_000n, [transferOut(30_000n)]);
    const destino = accountBalance(0n, [transferIn(30_000n)]);

    expect(origen).toBe(70_000n);
    expect(destino).toBe(30_000n);
    expect(origen + destino).toBe(100_000n);
  });

  it("no pierde precisión con importes enormes", () => {
    // 90 billones de pesos en centavos: muy por encima de 2^53.
    const balance = accountBalance(9_000_000_000_000_099n, [income(1n)]);
    expect(balance).toBe(9_000_000_000_000_100n);
  });
});

describe("totales de un período", () => {
  it("separa ingresos de egresos", () => {
    const totals = periodTotals([
      income(210_000n),
      expense(95_000n),
      expense(8_450n),
    ]);

    expect(totals.incomeMinor).toBe(210_000n);
    expect(totals.expenseMinor).toBe(103_450n);
    expect(totals.netMinor).toBe(106_550n);
  });

  it("EXCLUYE las transferencias de las dos columnas", () => {
    // Contarlas inflaría ingresos y egresos por igual, y "ingresos − egresos"
    // dejaría de coincidir con la variación del patrimonio.
    const sinTransferencias = periodTotals([
      income(100_000n),
      expense(30_000n),
    ]);
    const conTransferencias = periodTotals([
      income(100_000n),
      expense(30_000n),
      transferOut(50_000n),
      transferIn(50_000n),
    ]);

    expect(conTransferencias).toEqual(sinTransferencias);
  });

  it("el neto puede ser negativo", () => {
    expect(periodTotals([income(1000n), expense(3000n)]).netMinor).toBe(-2000n);
  });

  it("un período vacío da todo en cero", () => {
    expect(periodTotals([])).toEqual({
      incomeMinor: 0n,
      expenseMinor: 0n,
      netMinor: 0n,
    });
  });
});

describe("porcentajes", () => {
  it("calcula con un decimal", () => {
    expect(percentageOf(2500n, 10_000n)).toBe(25);
    expect(percentageOf(3333n, 10_000n)).toBe(33.3);
    expect(percentageOf(10_000n, 10_000n)).toBe(100);
  });

  it("no arrastra basura de punto flotante", () => {
    // En float, 1/3 daría 33.300000000000004. Se calcula en enteros y se
    // divide al final.
    const result = percentageOf(1n, 3n);
    expect(result).toBe(33.3);
    expect(Number.isInteger(result * 10)).toBe(true);
  });

  it("redondea al más cercano en vez de truncar", () => {
    // 86.07 % tiene que verse como 86.1, no como 86.0.
    expect(percentageOf(98_990n, 115_010n)).toBe(86.1);
    // Y el redondeo va hacia arriba justo en el medio: 0.05 → 0.1.
    expect(percentageOf(5n, 10_000n)).toBe(0.1);
  });

  it("el desglose de un reporte suma ~100 %", () => {
    // Truncar sesgaba a la baja: estas cuatro partes daban 99.8 %.
    const total = 115_010n;
    const parts = [98_990n, 13_030n, 1890n, 1100n];
    const sum = parts.reduce((acc, part) => acc + percentageOf(part, total), 0);

    expect(Math.abs(sum - 100)).toBeLessThanOrEqual(0.1);
  });

  it("un total en cero da cero, no NaN ni Infinity", () => {
    expect(percentageOf(100n, 0n)).toBe(0);
  });

  it("trabaja con valores absolutos", () => {
    expect(percentageOf(-2500n, 10_000n)).toBe(25);
    expect(percentageOf(2500n, -10_000n)).toBe(25);
  });

  it("no pierde precisión con importes grandes", () => {
    expect(percentageOf(1_000_000_000_000n, 4_000_000_000_000n)).toBe(25);
  });
});
