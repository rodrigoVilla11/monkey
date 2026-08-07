import { errors } from "@/server/api/errors";
import type { ScopedDb } from "@/server/db/scoped";
import {
  writeAuditLog,
  type TransactionClient,
} from "@/server/services/audit/log";
import { getRateProvider } from "@/server/services/rates";
import { counterpartAccounts } from "@/server/services/transfers";
import type { Page } from "@/shared/contracts/common";
import type {
  CreateTransactionRequest,
  TransactionDTO,
  TransactionFilters,
  UpdateTransactionRequest,
} from "@/shared/contracts/transactions";
import {
  fromCalendarDate,
  toCalendarDate,
  todayIn,
  type CalendarDate,
} from "@/shared/dates";
import { convert, money } from "@/shared/money";

/**
 * Transacciones.
 *
 * Dos cosas concentran casi toda la complejidad de este archivo:
 *
 * 1. **La conversión se congela al crear.** Si la moneda del movimiento difiere
 *    de la primaria del Space, se guarda la cotización usada Y el importe ya
 *    convertido. Un reporte de enero tiene que dar lo mismo hoy que en marzo;
 *    recalcular con la cotización de hoy lo haría cambiar solo.
 *
 * 2. **Los IDs relacionados vienen del body.** El cliente scopeado garantiza
 *    que la fila nazca en el Space correcto, pero no valida `accountId` ni
 *    `categoryId`. Se verifican explícitamente acá — y encima las claves
 *    foráneas compuestas (spaceId, id) los rechazarían en la base.
 */

const SELECT = {
  id: true,
  type: true,
  status: true,
  amountMinor: true,
  currency: true,
  exchangeRateSnapshot: true,
  amountPrimaryMinor: true,
  date: true,
  description: true,
  notes: true,
  payee: true,
  transferGroupId: true,
  transferDirection: true,
  createdAt: true,
  createdByUserId: true,
  createdByName: true,
  account: { select: { id: true, name: true, color: true, icon: true } },
  category: { select: { id: true, name: true, color: true, icon: true } },
  createdBy: { select: { avatarUrl: true } },
  tags: { select: { tag: { select: { id: true, name: true, color: true } } } },
} as const;

interface Row {
  id: string;
  type: string;
  status: string;
  amountMinor: bigint;
  currency: string;
  exchangeRateSnapshot: { toString(): string } | null;
  amountPrimaryMinor: bigint | null;
  date: Date;
  description: string | null;
  notes: string | null;
  payee: string | null;
  transferGroupId: string | null;
  transferDirection: "OUT" | "IN" | null;
  createdAt: Date;
  createdByUserId: string | null;
  createdByName: string;
  account: {
    id: string;
    name: string;
    color: string | null;
    icon: string | null;
  };
  category: {
    id: string;
    name: string;
    color: string | null;
    icon: string | null;
  } | null;
  createdBy: { avatarUrl: string | null } | null;
  tags: { tag: { id: string; name: string; color: string | null } }[];
}

const toDTO = (
  row: Row,
  primaryCurrency: string,
  counterparts?: ReadonlyMap<string, { id: string; name: string }>,
): TransactionDTO => ({
  id: row.id,
  type: row.type as TransactionDTO["type"],
  status: row.status as TransactionDTO["status"],
  amount: { amountMinor: row.amountMinor.toString(), currency: row.currency },
  amountPrimary:
    row.amountPrimaryMinor === null
      ? null
      : {
          amountMinor: row.amountPrimaryMinor.toString(),
          currency: primaryCurrency,
        },
  exchangeRate: row.exchangeRateSnapshot?.toString() ?? null,
  date: toCalendarDate(row.date),
  description: row.description,
  notes: row.notes,
  payee: row.payee,
  account: row.account,
  category: row.category,
  author: {
    userId: row.createdByUserId,
    name: row.createdByName,
    avatarUrl: row.createdBy?.avatarUrl ?? null,
  },
  tags: row.tags.map((t) => t.tag),
  transferGroupId: row.transferGroupId,
  transferDirection: row.transferDirection,
  transferCounterpartAccount: counterparts?.get(row.id) ?? null,
  createdAt: row.createdAt.toISOString(),
});

/** Traduce los filtros de la API a un `where` de Prisma. */
const buildWhere = (filters: TransactionFilters): Record<string, unknown> => {
  const where: Record<string, unknown> = {};

  if (filters.from !== undefined || filters.to !== undefined) {
    where.date = {
      ...(filters.from !== undefined
        ? { gte: fromCalendarDate(filters.from) }
        : {}),
      ...(filters.to !== undefined
        ? { lte: fromCalendarDate(filters.to) }
        : {}),
    };
  }

  if (filters.accountId !== undefined) {
    where.accountId = { in: filters.accountId };
  }
  if (filters.categoryId !== undefined) {
    where.categoryId = { in: filters.categoryId };
  }
  if (filters.createdByUserId !== undefined) {
    where.createdByUserId = { in: filters.createdByUserId };
  }
  if (filters.type !== undefined) {
    where.type = { in: filters.type };
  }
  if (filters.status !== undefined) {
    where.status = filters.status;
  }
  if (filters.tagId !== undefined) {
    where.tags = { some: { tagId: { in: filters.tagId } } };
  }

  if (
    filters.minAmountMinor !== undefined ||
    filters.maxAmountMinor !== undefined
  ) {
    where.amountMinor = {
      ...(filters.minAmountMinor !== undefined
        ? { gte: BigInt(filters.minAmountMinor) }
        : {}),
      ...(filters.maxAmountMinor !== undefined
        ? { lte: BigInt(filters.maxAmountMinor) }
        : {}),
    };
  }

  if (filters.search !== undefined && filters.search !== "") {
    where.OR = [
      { description: { contains: filters.search, mode: "insensitive" } },
      { payee: { contains: filters.search, mode: "insensitive" } },
      { notes: { contains: filters.search, mode: "insensitive" } },
    ];
  }

  return where;
};

/**
 * Listado con scroll infinito.
 *
 * Cursor y no offset: el listado crece por el principio, y con offset cargar
 * un movimiento nuevo mientras alguien scrollea desplaza la página y aparecen
 * duplicados.
 *
 * Se ordena por (date desc, id desc) y no solo por fecha: varias transacciones
 * del mismo día necesitan un desempate estable o el cursor se vuelve ambiguo.
 */
export const listTransactions = async (
  db: ScopedDb,
  primaryCurrency: string,
  filters: TransactionFilters,
  pagination: { readonly cursor?: string | undefined; readonly limit: number },
): Promise<Page<TransactionDTO>> => {
  const rows = await db.transaction.findMany({
    where: buildWhere(filters),
    orderBy: [{ date: "desc" }, { id: "desc" }],
    take: pagination.limit + 1,
    ...(pagination.cursor !== undefined
      ? { cursor: { id: pagination.cursor }, skip: 1 }
      : {}),
    select: SELECT,
  });

  // Se pide uno de más para saber si hay página siguiente sin hacer un count.
  const hasMore = rows.length > pagination.limit;
  const page = hasMore ? rows.slice(0, pagination.limit) : rows;

  // Una sola consulta para las contrapartes de toda la página, no una por fila.
  const counterparts = await counterpartAccounts(
    db,
    page
      .map((row) => row.transferGroupId)
      .filter((id): id is string => id !== null),
  );

  return {
    items: page.map((row) => toDTO(row as Row, primaryCurrency, counterparts)),
    nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null,
  };
};

export const getTransaction = async (
  db: ScopedDb,
  primaryCurrency: string,
  id: string,
): Promise<TransactionDTO> => {
  const row = await db.transaction.findFirst({ where: { id }, select: SELECT });
  if (row === null) throw errors.notFound("No se encontró el movimiento");

  const counterparts = await counterpartAccounts(
    db,
    row.transferGroupId === null ? [] : [row.transferGroupId],
  );

  return toDTO(row, primaryCurrency, counterparts);
};

interface SpaceContext {
  readonly spaceId: string;
  readonly primaryCurrency: string;
  readonly timezone: string;
}

interface Actor {
  readonly userId: string;
  readonly name: string;
  readonly timezone: string;
}

/**
 * Resuelve la conversión a la moneda primaria del Space.
 *
 * Devuelve `null` si la moneda coincide con la primaria: ahí no hay nada que
 * convertir y los dos campos quedan en null, que es lo que exige el CHECK
 * `Transaction_fx_snapshot_complete`.
 */
const resolveConversion = async (
  amountMinor: bigint,
  currency: string,
  primaryCurrency: string,
  date: CalendarDate,
  explicitRate: string | undefined,
): Promise<{ rate: string; amountPrimaryMinor: bigint } | null> => {
  if (currency === primaryCurrency) return null;

  let rate = explicitRate;

  if (rate === undefined) {
    const found = await getRateProvider().find(currency, primaryCurrency, date);
    if (found === null) {
      throw errors.conflict(
        "UNPROCESSABLE",
        `No hay cotización de ${currency} a ${primaryCurrency}. Cargá una o indicá el tipo de cambio`,
      );
    }
    rate = found.rate;
  }

  const converted = convert(
    money(amountMinor, currency),
    rate,
    primaryCurrency,
  );
  if (!converted.ok) {
    throw errors.conflict("UNPROCESSABLE", "El tipo de cambio no es válido");
  }

  return { rate, amountPrimaryMinor: converted.value.amountMinor };
};

/**
 * Verifica que los IDs relacionados sean del Space.
 *
 * Va por el cliente scopeado, así que un ID de otro Space simplemente no
 * aparece y se responde 404 — sin confirmar que exista en otro lado.
 */
const validateReferences = async (
  db: ScopedDb,
  accountId: string,
  categoryId: string | null | undefined,
  type: "INCOME" | "EXPENSE",
): Promise<{ currency: string }> => {
  const account = await db.account.findFirst({
    where: { id: accountId },
    select: { id: true, currency: true, isArchived: true },
  });

  if (account === null) throw errors.notFound("No se encontró la cuenta");
  if (account.isArchived) {
    throw errors.conflict(
      "CONFLICT",
      "No se pueden cargar movimientos en una cuenta archivada",
    );
  }

  if (categoryId != null) {
    const category = await db.category.findFirst({
      where: { id: categoryId },
      select: { id: true, kind: true },
    });
    if (category === null) throw errors.notFound("No se encontró la categoría");

    // Un gasto en una categoría de ingresos rompería todos los reportes.
    if (category.kind !== type) {
      throw errors.conflict(
        "CONFLICT",
        type === "EXPENSE"
          ? "Esa categoría es de ingresos"
          : "Esa categoría es de gastos",
      );
    }
  }

  return { currency: account.currency };
};

export const createTransaction = async (
  db: ScopedDb,
  tx: TransactionClient,
  space: SpaceContext,
  actor: Actor,
  input: CreateTransactionRequest,
): Promise<string> => {
  const { currency: accountCurrency } = await validateReferences(
    db,
    input.accountId,
    input.categoryId,
    input.type,
  );

  const currency = input.currency ?? accountCurrency;
  const amountMinor = BigInt(input.amountMinor);

  // "Hoy" en la timezone de quien carga, no la del servidor: a las 00:30 en
  // Madrid un server en UTC propondría el día anterior.
  const date = input.date ?? todayIn(actor.timezone);

  const conversion = await resolveConversion(
    amountMinor,
    currency,
    space.primaryCurrency,
    date,
    input.exchangeRate,
  );

  const created = await tx.transaction.create({
    data: {
      spaceId: space.spaceId,
      accountId: input.accountId,
      categoryId: input.categoryId ?? null,
      createdByUserId: actor.userId,
      createdByName: actor.name,
      type: input.type,
      status: input.status ?? "CLEARED",
      amountMinor,
      currency,
      date: fromCalendarDate(date),
      description: input.description ?? null,
      notes: input.notes ?? null,
      payee: input.payee ?? null,
      ...(conversion !== null
        ? {
            exchangeRateSnapshot: conversion.rate,
            amountPrimaryMinor: conversion.amountPrimaryMinor,
          }
        : {}),
    },
    select: { id: true },
  });

  if (input.tagIds !== undefined && input.tagIds.length > 0) {
    await attachTags(db, tx, space.spaceId, created.id, input.tagIds);
  }

  return created.id;
};

export const updateTransaction = async (
  db: ScopedDb,
  tx: TransactionClient,
  space: SpaceContext,
  id: string,
  input: UpdateTransactionRequest,
): Promise<void> => {
  const existing = await db.transaction.findFirst({
    where: { id },
    select: {
      id: true,
      type: true,
      currency: true,
      amountMinor: true,
      date: true,
      exchangeRateSnapshot: true,
      transferGroupId: true,
    },
  });

  if (existing === null) throw errors.notFound("No se encontró el movimiento");

  if (existing.transferGroupId !== null) {
    // Editar una pata suelta descuadraría la transferencia. Se editan las dos
    // juntas por su propio endpoint (Fase 2).
    throw errors.conflict(
      "CONFLICT",
      "Las transferencias se editan desde la transferencia, no desde una de sus patas",
    );
  }

  const type = existing.type as "INCOME" | "EXPENSE";

  if (input.accountId !== undefined || input.categoryId !== undefined) {
    await validateReferences(
      db,
      input.accountId ?? (await currentAccountId(db, id)),
      input.categoryId,
      type,
    );
  }

  const amountMinor =
    input.amountMinor !== undefined
      ? BigInt(input.amountMinor)
      : existing.amountMinor;
  const date = input.date ?? toCalendarDate(existing.date);

  /**
   * Si cambió el importe o la fecha y el movimiento estaba convertido, se
   * recalcula la conversión REUSANDO la cotización congelada. No se busca una
   * nueva: corregir un importe no puede cambiar la cotización histórica.
   */
  const needsReconversion =
    existing.exchangeRateSnapshot !== null &&
    (input.amountMinor !== undefined || input.date !== undefined);

  const conversion = needsReconversion
    ? await resolveConversion(
        amountMinor,
        existing.currency,
        space.primaryCurrency,
        date,
        existing.exchangeRateSnapshot?.toString(),
      )
    : null;

  await tx.transaction.update({
    where: { id },
    data: {
      ...(input.accountId !== undefined ? { accountId: input.accountId } : {}),
      ...(input.categoryId !== undefined
        ? { categoryId: input.categoryId }
        : {}),
      ...(input.amountMinor !== undefined ? { amountMinor } : {}),
      ...(input.date !== undefined ? { date: fromCalendarDate(date) } : {}),
      ...(input.description !== undefined
        ? { description: input.description }
        : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      ...(input.payee !== undefined ? { payee: input.payee } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(conversion !== null
        ? { amountPrimaryMinor: conversion.amountPrimaryMinor }
        : {}),
    },
  });

  if (input.tagIds !== undefined) {
    await tx.transactionTag.deleteMany({ where: { transactionId: id } });
    if (input.tagIds.length > 0) {
      await attachTags(db, tx, space.spaceId, id, input.tagIds);
    }
  }
};

const currentAccountId = async (db: ScopedDb, id: string): Promise<string> => {
  const row = await db.transaction.findFirst({
    where: { id },
    select: { accountId: true },
  });
  if (row === null) throw errors.notFound("No se encontró el movimiento");
  return row.accountId;
};

/** Valida que los tags sean del Space y los vincula. */
const attachTags = async (
  db: ScopedDb,
  tx: TransactionClient,
  spaceId: string,
  transactionId: string,
  tagIds: readonly string[],
): Promise<void> => {
  const unique = [...new Set(tagIds)];
  const found = await db.tag.findMany({
    where: { id: { in: unique } },
    select: { id: true },
  });

  if (found.length !== unique.length) {
    throw errors.notFound("Alguna etiqueta no existe en este espacio");
  }

  await tx.transactionTag.createMany({
    data: found.map((tag) => ({ spaceId, transactionId, tagId: tag.id })),
    skipDuplicates: true,
  });
};

export const deleteTransaction = async (
  db: ScopedDb,
  tx: TransactionClient,
  id: string,
): Promise<void> => {
  const existing = await db.transaction.findFirst({
    where: { id },
    select: { id: true, transferGroupId: true },
  });

  if (existing === null) throw errors.notFound("No se encontró el movimiento");

  // Borrar una sola pata dejaría la otra huérfana y descuadraría los saldos.
  const ids =
    existing.transferGroupId === null
      ? [id]
      : (
          await db.transaction.findMany({
            where: { transferGroupId: existing.transferGroupId },
            select: { id: true },
          })
        ).map((row) => row.id);

  await tx.transaction.updateMany({
    where: { id: { in: ids } },
    data: { deletedAt: new Date() },
  });
};

/**
 * Borrado masivo. Requiere ADMIN y queda auditado: es la operación más
 * destructiva del dominio financiero.
 */
export const bulkDeleteTransactions = async (
  db: ScopedDb,
  tx: TransactionClient,
  spaceId: string,
  ids: readonly string[],
  actor: { readonly userId: string; readonly name: string },
): Promise<number> => {
  // Se filtra por el cliente scopeado: los IDs de otro Space no aparecen y
  // simplemente no se borran.
  const found = await db.transaction.findMany({
    where: { id: { in: [...ids] } },
    select: { id: true },
  });

  if (found.length === 0) return 0;

  const result = await tx.transaction.updateMany({
    where: { spaceId, id: { in: found.map((r) => r.id) } },
    data: { deletedAt: new Date() },
  });

  await writeAuditLog(tx, {
    spaceId,
    actorUserId: actor.userId,
    actorName: actor.name,
    action: "TRANSACTIONS_BULK_DELETED",
    entityType: "Transaction",
    metadata: { requested: ids.length, deleted: result.count },
  });

  return result.count;
};
