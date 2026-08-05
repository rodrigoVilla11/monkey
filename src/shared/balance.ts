/**
 * Cálculo de saldos. Lógica pura, sin base de datos.
 *
 * Está en `shared/` y no en `server/` a propósito: es lógica de dominio pura,
 * se testea sin montar nada, y un cliente nativo puede reusarla para mostrar
 * saldos optimistas antes de que responda el servidor.
 *
 * El saldo NO se guarda desnormalizado. Se calcula a partir del saldo de
 * apertura y de los movimientos.
 */

export type BalanceTransactionType = "INCOME" | "EXPENSE" | "TRANSFER";
export type BalanceTransferDirection = "OUT" | "IN";

export interface BalanceMovement {
  readonly type: BalanceTransactionType;
  readonly amountMinor: bigint;
  /** Obligatorio cuando type es TRANSFER; ignorado en el resto. */
  readonly transferDirection?: BalanceTransferDirection | null;
}

/**
 * Signo de un movimiento respecto del saldo de su cuenta.
 *
 * El importe se guarda SIEMPRE positivo; el signo sale del tipo. Las dos patas
 * de una transferencia comparten el tipo TRANSFER y afectan en sentidos
 * opuestos, por eso hace falta `transferDirection`.
 */
export const movementSign = (movement: BalanceMovement): -1n | 0n | 1n => {
  switch (movement.type) {
    case "INCOME":
      return 1n;
    case "EXPENSE":
      return -1n;
    case "TRANSFER":
      if (movement.transferDirection === "IN") return 1n;
      if (movement.transferDirection === "OUT") return -1n;
      // Una pata sin sentido es un dato corrupto. Se ignora en vez de adivinar
      // un signo: un CHECK en la base impide que llegue a existir.
      return 0n;
  }
};

/** Efecto de un movimiento sobre el saldo, ya con signo. */
export const signedAmount = (movement: BalanceMovement): bigint =>
  movementSign(movement) * movement.amountMinor;

/**
 * Saldo de una cuenta: apertura + suma de sus movimientos.
 *
 * En producción la suma se hace en SQL con `groupBy`, no trayendo las filas a
 * memoria. Esta función es la definición de referencia y la que se testea.
 */
export const accountBalance = (
  initialBalanceMinor: bigint,
  movements: readonly BalanceMovement[],
): bigint =>
  movements.reduce(
    (total, movement) => total + signedAmount(movement),
    initialBalanceMinor,
  );

/**
 * Totales de ingresos y egresos de un período.
 *
 * Las TRANSFERENCIAS se excluyen a propósito: mover plata entre dos cuentas
 * propias no es ni ingreso ni gasto. Contarlas infla las dos columnas y hace
 * que "ingresos − egresos" deje de coincidir con la variación del patrimonio.
 */
export interface PeriodTotals {
  readonly incomeMinor: bigint;
  readonly expenseMinor: bigint;
  readonly netMinor: bigint;
}

export const periodTotals = (
  movements: readonly BalanceMovement[],
): PeriodTotals => {
  let incomeMinor = 0n;
  let expenseMinor = 0n;

  for (const movement of movements) {
    if (movement.type === "INCOME") incomeMinor += movement.amountMinor;
    else if (movement.type === "EXPENSE") expenseMinor += movement.amountMinor;
    // TRANSFER: no cuenta ni de un lado ni del otro.
  }

  return { incomeMinor, expenseMinor, netMinor: incomeMinor - expenseMinor };
};

/**
 * Porcentaje de una parte sobre un total, con un decimal.
 *
 * Se calcula en enteros y se divide al final: pasar por float antes de
 * redondear daría 33.300000000000004 en casos triviales.
 */
export const percentageOf = (partMinor: bigint, totalMinor: bigint): number => {
  if (totalMinor === 0n) return 0;

  const part = partMinor < 0n ? -partMinor : partMinor;
  const total = totalMinor < 0n ? -totalMinor : totalMinor;

  // ×1000 para conservar un decimal después de la división entera.
  return Number((part * 1000n) / total) / 10;
};
