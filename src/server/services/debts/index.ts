import { errors } from "@/server/api/errors";
import type { ScopedDb } from "@/server/db/scoped";
import { accountBalances } from "@/server/services/balances";
import type { TransactionClient } from "@/server/services/audit/log";
import type { MoneyDTO } from "@/shared/contracts/common";
import type {
  CreateDebtPaymentRequest,
  CreateDebtRequest,
  DebtDetail,
  DebtDTO,
  DebtFilters,
  DebtPaymentDTO,
  NetPositionDTO,
  UpdateDebtRequest,
} from "@/shared/contracts/debts";
import {
  fromCalendarDate,
  toCalendarDate,
  todayIn,
  type CalendarDate,
} from "@/shared/dates";
import {
  debtBalance,
  debtForecast,
  installmentProgress,
  monthlyInterestCost,
  netPosition,
  type DebtDirection,
} from "@/shared/debt";

/**
 * Deudas y préstamos.
 *
 * ── Lo que este módulo NO hace ──────────────────────────────────────────────
 *
 * **No amortiza.** El saldo es `original − pagos`, sin capitalizar intereses.
 * Calcular la cuota de un préstamo daría un número que no coincide con el
 * recibo del banco —convenciones de días, comisiones, seguros, redondeos— y un
 * número casi correcto en finanzas es peor que ninguno.
 *
 * **No crea movimientos.** Un pago se vincula a uno que ya existe o se registra
 * suelto, igual que los aportes a metas. Si el pago generara un gasto, cargarlo
 * desde acá y desde la pantalla de movimientos lo contaría dos veces.
 *
 * ── Sobre el patrimonio ─────────────────────────────────────────────────────
 *
 * La posición neta (`netPositionOf`) vive en su propio endpoint y no toca la
 * curva de patrimonio de los reportes. Esa curva es una posición de CAJA;
 * meterle deudas redefiniría en silencio lo que significan todos los reportes
 * que ya existen.
 */

const DEBT_SELECT = {
  id: true,
  direction: true,
  counterparty: true,
  description: true,
  originalAmountMinor: true,
  currency: true,
  interestRateBps: true,
  startDate: true,
  dueDate: true,
  installmentsTotal: true,
  closedAt: true,
  createdAt: true,
  account: { select: { id: true, name: true, currency: true } },
} as const;

interface DebtRow {
  id: string;
  direction: string;
  counterparty: string;
  description: string | null;
  originalAmountMinor: bigint;
  currency: string;
  interestRateBps: number | null;
  startDate: Date;
  dueDate: Date | null;
  installmentsTotal: number | null;
  closedAt: Date | null;
  createdAt: Date;
  account: { id: string; name: string; currency: string } | null;
}

interface Rollup {
  readonly paidMinor: bigint;
  readonly count: number;
  readonly firstDate: CalendarDate | null;
}

const EMPTY: Rollup = { paidMinor: 0n, count: 0, firstDate: null };

const money = (amountMinor: bigint, currency: string): MoneyDTO => ({
  amountMinor: amountMinor.toString(),
  currency,
});

const toDTO = (row: DebtRow, rollup: Rollup, today: CalendarDate): DebtDTO => {
  const balance = debtBalance(row.originalAmountMinor, rollup.paidMinor);
  const dueDate = row.dueDate === null ? null : toCalendarDate(row.dueDate);

  const forecast = debtForecast({
    remainingMinor: balance.remainingMinor,
    paidMinor: balance.paidMinor,
    dueDate,
    firstPaymentDate: rollup.firstDate,
    today,
  });

  const interest = monthlyInterestCost(
    balance.remainingMinor,
    row.interestRateBps,
  );

  return {
    id: row.id,
    direction: row.direction as DebtDirection,
    counterparty: row.counterparty,
    description: row.description,
    original: money(row.originalAmountMinor, row.currency),
    paid: money(balance.paidMinor, row.currency),
    remaining: money(balance.remainingMinor, row.currency),
    overpaid: money(balance.overpaidMinor, row.currency),
    percentage: balance.percentage,
    settled: balance.settled,
    closedAt: row.closedAt?.toISOString() ?? null,
    interestRateBps: row.interestRateBps,
    monthlyInterestCost:
      interest === null ? null : money(interest, row.currency),
    startDate: toCalendarDate(row.startDate),
    dueDate,
    installments: installmentProgress(rollup.count, row.installmentsTotal),
    paymentCount: rollup.count,
    account: row.account,
    status: forecast.status,
    daysRemaining: forecast.daysRemaining,
    requiredPerMonth:
      forecast.requiredPerMonthMinor === null
        ? null
        : money(forecast.requiredPerMonthMinor, row.currency),
    actualPerMonth:
      forecast.actualPerMonthMinor === null
        ? null
        : money(forecast.actualPerMonthMinor, row.currency),
    projectedDate: forecast.projectedDate,
    createdAt: row.createdAt.toISOString(),
  };
};

/** Totales de pagos de varias deudas en UNA consulta, no una por deuda. */
const rollupsFor = async (
  db: ScopedDb,
  debtIds: readonly string[],
): Promise<Map<string, Rollup>> => {
  const result = new Map<string, Rollup>();
  if (debtIds.length === 0) return result;

  const grouped = await db.debtPayment.groupBy({
    by: ["debtId"],
    where: { debtId: { in: [...debtIds] } },
    _sum: { amountMinor: true },
    _count: { _all: true },
    _min: { date: true },
  });

  for (const row of grouped) {
    result.set(row.debtId, {
      paidMinor: row._sum.amountMinor ?? 0n,
      count: row._count._all,
      firstDate: row._min.date === null ? null : toCalendarDate(row._min.date),
    });
  }

  return result;
};

export const listDebts = async (
  db: ScopedDb,
  timezone: string,
  filters: DebtFilters,
): Promise<DebtDTO[]> => {
  const rows = await db.debt.findMany({
    where: {
      ...(filters.includeSettled === true ? {} : { closedAt: null }),
      ...(filters.direction !== undefined
        ? { direction: filters.direction }
        : {}),
    },
    // Por urgencia: lo que vence antes primero, lo sin plazo al final.
    orderBy: [
      { dueDate: { sort: "asc", nulls: "last" } },
      { createdAt: "asc" },
    ],
    select: DEBT_SELECT,
  });

  const rollups = await rollupsFor(
    db,
    rows.map((row) => row.id),
  );
  const today = todayIn(timezone);

  return rows.map((row) => toDTO(row, rollups.get(row.id) ?? EMPTY, today));
};

export const getDebt = async (
  db: ScopedDb,
  timezone: string,
  id: string,
): Promise<DebtDetail> => {
  const row = await db.debt.findFirst({ where: { id }, select: DEBT_SELECT });
  if (row === null) throw errors.notFound("No se encontró la deuda");

  const rollups = await rollupsFor(db, [id]);
  const dto = toDTO(row, rollups.get(id) ?? EMPTY, todayIn(timezone));

  const payments = await db.debtPayment.findMany({
    where: { debtId: id },
    orderBy: [{ date: "desc" }, { id: "desc" }],
    select: {
      id: true,
      amountMinor: true,
      date: true,
      installmentNo: true,
      createdAt: true,
      transaction: {
        select: {
          id: true,
          description: true,
          account: { select: { name: true } },
        },
      },
    },
  });

  return {
    ...dto,
    payments: payments.map((item): DebtPaymentDTO => ({
      id: item.id,
      amount: money(item.amountMinor, row.currency),
      date: toCalendarDate(item.date),
      installmentNo: item.installmentNo,
      transaction:
        item.transaction === null
          ? null
          : {
              id: item.transaction.id,
              description: item.transaction.description,
              accountName: item.transaction.account.name,
            },
      createdAt: item.createdAt.toISOString(),
    })),
  };
};

// ─────────────────────────────── escritura ───────────────────────────────────

interface SpaceContext {
  readonly spaceId: string;
  readonly primaryCurrency: string;
}

const validateAccount = async (
  db: ScopedDb,
  accountId: string | null | undefined,
): Promise<void> => {
  if (accountId == null) return;

  const account = await db.account.findFirst({
    where: { id: accountId },
    select: { isArchived: true },
  });

  if (account === null) throw errors.notFound("No se encontró la cuenta");
  if (account.isArchived) {
    throw errors.conflict("CONFLICT", "Esa cuenta está archivada");
  }
};

export const createDebt = async (
  db: ScopedDb,
  tx: TransactionClient,
  space: SpaceContext,
  input: CreateDebtRequest,
): Promise<string> => {
  await validateAccount(db, input.accountId);

  const created = await tx.debt.create({
    data: {
      spaceId: space.spaceId,
      accountId: input.accountId ?? null,
      direction: input.direction,
      counterparty: input.counterparty,
      description: input.description ?? null,
      originalAmountMinor: BigInt(input.originalAmountMinor),
      currency: input.currency ?? space.primaryCurrency,
      interestRateBps: input.interestRateBps ?? null,
      startDate: fromCalendarDate(input.startDate),
      dueDate: input.dueDate == null ? null : fromCalendarDate(input.dueDate),
      installmentsTotal: input.installmentsTotal ?? null,
    },
    select: { id: true },
  });

  return created.id;
};

export const updateDebt = async (
  db: ScopedDb,
  tx: TransactionClient,
  spaceId: string,
  id: string,
  input: UpdateDebtRequest,
): Promise<void> => {
  const existing = await db.debt.findFirst({
    where: { id },
    select: { startDate: true, dueDate: true },
  });
  if (existing === null) throw errors.notFound("No se encontró la deuda");

  await validateAccount(db, input.accountId);

  /**
   * El vencimiento no puede quedar antes del inicio combinando la edición con
   * lo que ya había. El esquema Zod solo ve lo que llega; acá se ve el
   * resultado.
   */
  const startDate = input.startDate ?? toCalendarDate(existing.startDate);
  const dueDate =
    input.dueDate !== undefined
      ? input.dueDate
      : existing.dueDate === null
        ? null
        : toCalendarDate(existing.dueDate);

  if (dueDate !== null && dueDate < startDate) {
    throw errors.conflict(
      "UNPROCESSABLE",
      "El vencimiento no puede ser anterior al inicio",
    );
  }

  await tx.debt.update({
    where: { id },
    data: {
      ...(input.counterparty !== undefined
        ? { counterparty: input.counterparty }
        : {}),
      ...(input.description !== undefined
        ? { description: input.description }
        : {}),
      ...(input.originalAmountMinor !== undefined
        ? { originalAmountMinor: BigInt(input.originalAmountMinor) }
        : {}),
      ...(input.interestRateBps !== undefined
        ? { interestRateBps: input.interestRateBps }
        : {}),
      ...(input.accountId !== undefined ? { accountId: input.accountId } : {}),
      ...(input.startDate !== undefined
        ? { startDate: fromCalendarDate(input.startDate) }
        : {}),
      ...(input.dueDate !== undefined
        ? { dueDate: dueDate === null ? null : fromCalendarDate(dueDate) }
        : {}),
      ...(input.installmentsTotal !== undefined
        ? { installmentsTotal: input.installmentsTotal }
        : {}),
    },
  });

  // Subir el importe puede reabrir una deuda que estaba saldada.
  await refreshClosed(tx, spaceId, id);
};

export const deleteDebt = async (
  db: ScopedDb,
  tx: TransactionClient,
  id: string,
): Promise<void> => {
  const existing = await db.debt.findFirst({
    where: { id },
    select: { id: true },
  });
  if (existing === null) throw errors.notFound("No se encontró la deuda");

  /**
   * Borrado lógico. Los pagos se van con ella —no significan nada solos— pero
   * los MOVIMIENTOS vinculados no se tocan: son plata que salió de verdad.
   */
  await tx.debt.update({ where: { id }, data: { deletedAt: new Date() } });
};

// ──────────────────────────────── pagos ──────────────────────────────────────

export const addPayment = async (
  db: ScopedDb,
  tx: TransactionClient,
  space: SpaceContext,
  debtId: string,
  timezone: string,
  input: CreateDebtPaymentRequest,
): Promise<string> => {
  const debt = await db.debt.findFirst({
    where: { id: debtId },
    select: { id: true, currency: true, installmentsTotal: true },
  });
  if (debt === null) throw errors.notFound("No se encontró la deuda");

  if (
    input.installmentNo != null &&
    debt.installmentsTotal !== null &&
    input.installmentNo > debt.installmentsTotal
  ) {
    throw errors.conflict(
      "UNPROCESSABLE",
      `La deuda se pactó en ${String(debt.installmentsTotal)} cuotas`,
    );
  }

  /**
   * Los índices únicos de la base son la garantía; estos chequeos existen para
   * dar un mensaje que se entienda. Sin ellos el usuario vería "eso ya existe"
   * sin saber qué, y sin los índices dos peticiones simultáneas sí lograrían
   * contar el mismo pago dos veces.
   */
  if (input.transactionId !== undefined) {
    const already = await db.debtPayment.findFirst({
      where: { transactionId: input.transactionId },
      select: { debtId: true },
    });

    if (already !== null) {
      throw errors.conflict(
        "CONFLICT",
        already.debtId === debtId
          ? "Ese movimiento ya está contado en esta deuda"
          : "Ese movimiento ya está contado en otra deuda",
      );
    }
  }

  if (input.installmentNo != null) {
    const already = await db.debtPayment.findFirst({
      where: { debtId, installmentNo: input.installmentNo },
      select: { id: true },
    });

    if (already !== null) {
      throw errors.conflict(
        "CONFLICT",
        `La cuota ${String(input.installmentNo)} ya está registrada`,
      );
    }
  }

  const resolved = await resolveAmount(db, space, debt.currency, input);

  const created = await tx.debtPayment.create({
    data: {
      spaceId: space.spaceId,
      debtId,
      transactionId: input.transactionId ?? null,
      amountMinor: resolved.amountMinor,
      date: fromCalendarDate(resolved.date ?? input.date ?? todayIn(timezone)),
      installmentNo: input.installmentNo ?? null,
    },
    select: { id: true },
  });

  await refreshClosed(tx, space.spaceId, debtId);

  return created.id;
};

/**
 * Importe y fecha del pago.
 *
 * Vinculado a un movimiento, los dos salen de él: escribirlos a mano permitiría
 * que el pago diga 200 y la transferencia 180.
 */
const resolveAmount = async (
  db: ScopedDb,
  space: SpaceContext,
  debtCurrency: string,
  input: CreateDebtPaymentRequest,
): Promise<{ amountMinor: bigint; date: CalendarDate | null }> => {
  if (input.transactionId === undefined) {
    // El schema garantiza que si no hay movimiento hay importe.
    return { amountMinor: BigInt(input.amountMinor ?? "0"), date: null };
  }

  const transaction = await db.transaction.findFirst({
    where: { id: input.transactionId },
    select: {
      amountMinor: true,
      amountPrimaryMinor: true,
      currency: true,
      date: true,
    },
  });

  if (transaction === null) {
    throw errors.notFound("No se encontró el movimiento");
  }

  if (transaction.currency === debtCurrency) {
    return {
      amountMinor: transaction.amountMinor,
      date: toCalendarDate(transaction.date),
    };
  }

  /**
   * Monedas distintas: solo se resuelve si la deuda está en la primaria, porque
   * ahí el movimiento ya trae su importe convertido Y congelado. Inventar una
   * conversión nueva metería un número aproximado en un saldo de deuda.
   */
  if (
    debtCurrency === space.primaryCurrency &&
    transaction.amountPrimaryMinor !== null
  ) {
    return {
      amountMinor: transaction.amountPrimaryMinor,
      date: toCalendarDate(transaction.date),
    };
  }

  throw errors.conflict(
    "UNPROCESSABLE",
    `El movimiento está en ${transaction.currency} y la deuda en ${debtCurrency}: cargá el pago con el importe que corresponda`,
  );
};

export const removePayment = async (
  db: ScopedDb,
  tx: TransactionClient,
  spaceId: string,
  debtId: string,
  paymentId: string,
): Promise<void> => {
  const existing = await db.debtPayment.findFirst({
    where: { id: paymentId, debtId },
    select: { id: true },
  });
  if (existing === null) throw errors.notFound("No se encontró el pago");

  // Borrado real: un pago no es un hecho económico, es una anotación sobre uno.
  // El movimiento vinculado, si lo hay, queda intacto.
  await tx.debtPayment.delete({ where: { id: paymentId } });

  await refreshClosed(tx, spaceId, debtId);
};

/**
 * Recalcula `closedAt` después de cualquier cambio.
 *
 * Se cierra al cubrir el importe y se REABRE si el total vuelve a quedar corto
 * —porque se borró un pago o se subió el importe pactado—. Una deuda marcada
 * como saldada con saldo pendiente es una contradicción en pantalla.
 *
 * **Lee por `tx` y no por el cliente scopeado.** El pago recién escrito todavía
 * no está confirmado: leyéndolo desde afuera de la transacción se ve el estado
 * ANTERIOR y la deuda nunca se cerraría ni se reabriría. Como `tx` no está
 * scopeado, el `spaceId` va explícito.
 */
const refreshClosed = async (
  tx: TransactionClient,
  spaceId: string,
  debtId: string,
): Promise<void> => {
  const debt = await tx.debt.findFirst({
    where: { id: debtId, spaceId, deletedAt: null },
    select: { originalAmountMinor: true, closedAt: true },
  });
  if (debt === null) return;

  const total = await tx.debtPayment.aggregate({
    where: { debtId, spaceId },
    _sum: { amountMinor: true },
  });

  const settled = (total._sum.amountMinor ?? 0n) >= debt.originalAmountMinor;

  if (settled && debt.closedAt === null) {
    await tx.debt.update({
      where: { id: debtId },
      data: { closedAt: new Date() },
    });
  } else if (!settled && debt.closedAt !== null) {
    await tx.debt.update({ where: { id: debtId }, data: { closedAt: null } });
  }
};

// ───────────────────────────── posición neta ─────────────────────────────────

/**
 * Caja + lo que te deben − lo que debés.
 *
 * Solo entran las deudas en la moneda primaria: sumar monedas distintas exige
 * una cotización, y este número no es lugar para inventar una. Las que quedan
 * afuera se cuentan en `excludedCount` para que la pantalla pueda decirlo en
 * vez de mostrar un total silenciosamente incompleto.
 */
export const netPositionOf = async (
  db: ScopedDb,
  space: SpaceContext,
): Promise<NetPositionDTO> => {
  const [balances, debts] = await Promise.all([
    accountBalances(db),
    db.debt.findMany({
      where: { closedAt: null },
      select: {
        id: true,
        direction: true,
        currency: true,
        originalAmountMinor: true,
      },
    }),
  ]);

  let accountsMinor = 0n;
  for (const balance of balances.values()) {
    // Igual que arriba: no se suman monedas distintas sin cotización.
    if (balance.currency === space.primaryCurrency) {
      accountsMinor += balance.balanceMinor;
    }
  }

  const rollups = await rollupsFor(
    db,
    debts.map((debt) => debt.id),
  );

  let receivableMinor = 0n;
  let payableMinor = 0n;
  let excludedCount = 0;

  for (const debt of debts) {
    if (debt.currency !== space.primaryCurrency) {
      excludedCount += 1;
      continue;
    }

    const { remainingMinor } = debtBalance(
      debt.originalAmountMinor,
      rollups.get(debt.id)?.paidMinor ?? 0n,
    );

    if (debt.direction === "OWED_TO_ME") receivableMinor += remainingMinor;
    else payableMinor += remainingMinor;
  }

  const position = netPosition(accountsMinor, receivableMinor, payableMinor);

  return {
    accounts: money(position.accountsMinor, space.primaryCurrency),
    receivable: money(position.receivableMinor, space.primaryCurrency),
    payable: money(position.payableMinor, space.primaryCurrency),
    net: money(position.netMinor, space.primaryCurrency),
    excludedCount,
  };
};
