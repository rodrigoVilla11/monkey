import { errors } from "@/server/api/errors";
import type { ScopedDb } from "@/server/db/scoped";
import type { TransactionClient } from "@/server/services/audit/log";
import type {
  CreateRecurringRuleRequest,
  RecurringRuleDTO,
  RecurringRuleFilters,
  UpdateRecurringRuleRequest,
} from "@/shared/contracts/recurring";
import {
  fromCalendarDate,
  toCalendarDate,
  type CalendarDate,
} from "@/shared/dates";
import {
  describeRecurrence,
  firstOccurrence,
  validateRecurrence,
  type RecurrenceSpec,
} from "@/shared/recurrence";

/**
 * Reglas recurrentes: alta, baja y modificación.
 *
 * La materialización vive aparte, en `materialize.ts`: este módulo solo maneja
 * la instrucción, no las transacciones que salen de ella.
 *
 * Lo único delicado de acá es `nextRunDate`. Se guarda desnormalizado —el motor
 * lo sabe calcular— por una razón concreta: el job barre TODOS los Spaces
 * buscando reglas vencidas, y sin una columna indexada tendría que traer cada
 * regla del sistema y evaluarla en memoria en cada corrida.
 *
 * La contrapartida es que hay que recalcularlo en cada edición que toque el
 * patrón. Se hace en un solo lugar, `nextRunFor`, y hay un test que verifica
 * que editar una regla no desplace la serie.
 */

const SELECT = {
  id: true,
  type: true,
  amountMinor: true,
  currency: true,
  description: true,
  payee: true,
  frequency: true,
  interval: true,
  byMonthDay: true,
  byWeekday: true,
  byMonth: true,
  startDate: true,
  endDate: true,
  maxOccurrences: true,
  nextRunDate: true,
  lastRunAt: true,
  occurrencesCreated: true,
  autoPost: true,
  isActive: true,
  createdAt: true,
  account: { select: { id: true, name: true, color: true, icon: true } },
  category: { select: { id: true, name: true, color: true, icon: true } },
} as const;

interface Row {
  id: string;
  type: string;
  amountMinor: bigint;
  currency: string;
  description: string | null;
  payee: string | null;
  frequency: string;
  interval: number;
  byMonthDay: number | null;
  byWeekday: number | null;
  byMonth: number | null;
  startDate: Date;
  endDate: Date | null;
  maxOccurrences: number | null;
  nextRunDate: Date;
  lastRunAt: Date | null;
  occurrencesCreated: number;
  autoPost: boolean;
  isActive: boolean;
  createdAt: Date;
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
}

/** La forma que el motor entiende, sacada de una fila. */
export const specOf = (row: {
  frequency: string;
  interval: number;
  startDate: Date;
  endDate: Date | null;
  maxOccurrences: number | null;
  byMonthDay: number | null;
  byWeekday: number | null;
  byMonth: number | null;
}): RecurrenceSpec => ({
  frequency: row.frequency as RecurrenceSpec["frequency"],
  interval: row.interval,
  startDate: toCalendarDate(row.startDate),
  endDate: row.endDate === null ? null : toCalendarDate(row.endDate),
  maxOccurrences: row.maxOccurrences,
  byMonthDay: row.byMonthDay,
  byWeekday: row.byWeekday,
  byMonth: row.byMonth,
});

const toDTO = (row: Row): RecurringRuleDTO => {
  const spec = specOf(row);

  return {
    id: row.id,
    type: row.type as "INCOME" | "EXPENSE",
    amount: { amountMinor: row.amountMinor.toString(), currency: row.currency },
    description: row.description,
    payee: row.payee,
    account: row.account,
    category: row.category,
    frequency: spec.frequency,
    interval: row.interval,
    byMonthDay: row.byMonthDay,
    byWeekday: row.byWeekday,
    byMonth: row.byMonth,
    summary: describeRecurrence(spec),
    startDate: toCalendarDate(row.startDate),
    endDate: row.endDate === null ? null : toCalendarDate(row.endDate),
    maxOccurrences: row.maxOccurrences,
    /**
     * Una regla terminada conserva su `nextRunDate` en la base —la columna no
     * admite null— pero hacia afuera es `null`: mostrar una próxima fecha que
     * nunca va a ocurrir es peor que no mostrar ninguna.
     */
    nextRunDate: row.isActive ? toCalendarDate(row.nextRunDate) : null,
    lastRunAt: row.lastRunAt?.toISOString() ?? null,
    occurrencesCreated: row.occurrencesCreated,
    autoPost: row.autoPost,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
  };
};

export const listRecurringRules = async (
  db: ScopedDb,
  filters: RecurringRuleFilters,
): Promise<RecurringRuleDTO[]> => {
  const rows = await db.recurringRule.findMany({
    where: filters.includeInactive === true ? {} : { isActive: true },
    // Por próxima fecha: lo que viene primero, primero.
    orderBy: [{ isActive: "desc" }, { nextRunDate: "asc" }],
    select: SELECT,
  });

  return rows.map((row) => toDTO(row as Row));
};

export const getRecurringRule = async (
  db: ScopedDb,
  id: string,
): Promise<RecurringRuleDTO> => {
  const row = await db.recurringRule.findFirst({
    where: { id },
    select: SELECT,
  });
  if (row === null) throw errors.notFound("No se encontró la regla");
  return toDTO(row);
};

/**
 * Verifica que cuenta y categoría sean del Space y compatibles.
 *
 * Es la misma comprobación que hace el alta de transacciones, y por el mismo
 * motivo: los IDs vienen del body y el cliente scopeado garantiza dónde nace la
 * fila, no que los IDs relacionados sean de ahí.
 */
const validateReferences = async (
  db: ScopedDb,
  accountId: string,
  categoryId: string | null | undefined,
  type: "INCOME" | "EXPENSE",
): Promise<{ currency: string }> => {
  const account = await db.account.findFirst({
    where: { id: accountId },
    select: { currency: true, isArchived: true },
  });

  if (account === null) throw errors.notFound("No se encontró la cuenta");
  if (account.isArchived) {
    throw errors.conflict(
      "CONFLICT",
      "No se puede programar un movimiento en una cuenta archivada",
    );
  }

  if (categoryId != null) {
    const category = await db.category.findFirst({
      where: { id: categoryId },
      select: { kind: true, isArchived: true },
    });
    if (category === null) throw errors.notFound("No se encontró la categoría");
    if (category.isArchived) {
      throw errors.conflict(
        "CONFLICT",
        "Esa categoría está archivada: sacala del archivo o elegí otra",
      );
    }
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

/**
 * `nextRunDate` de una regla recién creada o reanclada.
 *
 * Es la PRIMERA ocurrencia del patrón, aunque caiga en el pasado. Eso es lo que
 * permite crear una regla con `startDate` vieja para que el job rellene lo que
 * falta — es una función, no un accidente.
 */
const nextRunFor = (spec: RecurrenceSpec): CalendarDate => {
  const problems = validateRecurrence(spec);
  if (problems.length > 0) {
    throw errors.validation({ recurrence: problems });
  }
  return firstOccurrence(spec);
};

export const createRecurringRule = async (
  db: ScopedDb,
  tx: TransactionClient,
  space: { readonly spaceId: string },
  actor: { readonly userId: string; readonly name: string },
  input: CreateRecurringRuleRequest,
): Promise<string> => {
  const { currency: accountCurrency } = await validateReferences(
    db,
    input.accountId,
    input.categoryId,
    input.type,
  );

  const spec: RecurrenceSpec = {
    frequency: input.frequency,
    interval: input.interval,
    startDate: input.startDate,
    endDate: input.endDate ?? null,
    maxOccurrences: input.maxOccurrences ?? null,
    byMonthDay: input.byMonthDay ?? null,
    byWeekday: input.byWeekday ?? null,
    byMonth: input.byMonth ?? null,
  };

  const created = await tx.recurringRule.create({
    data: {
      spaceId: space.spaceId,
      accountId: input.accountId,
      categoryId: input.categoryId ?? null,
      createdByUserId: actor.userId,
      createdByName: actor.name,
      type: input.type,
      amountMinor: BigInt(input.amountMinor),
      currency: input.currency ?? accountCurrency,
      description: input.description ?? null,
      payee: input.payee ?? null,
      frequency: input.frequency,
      interval: input.interval,
      byMonthDay: input.byMonthDay ?? null,
      byWeekday: input.byWeekday ?? null,
      byMonth: input.byMonth ?? null,
      startDate: fromCalendarDate(input.startDate),
      endDate: input.endDate == null ? null : fromCalendarDate(input.endDate),
      maxOccurrences: input.maxOccurrences ?? null,
      nextRunDate: fromCalendarDate(nextRunFor(spec)),
      autoPost: input.autoPost,
      isActive: input.isActive,
    },
    select: { id: true },
  });

  return created.id;
};

/** Campos cuyo cambio obliga a recalcular la serie. */
const PATTERN_FIELDS = [
  "frequency",
  "interval",
  "byMonthDay",
  "byWeekday",
  "byMonth",
  "startDate",
  "endDate",
  "maxOccurrences",
] as const;

export const updateRecurringRule = async (
  db: ScopedDb,
  tx: TransactionClient,
  id: string,
  input: UpdateRecurringRuleRequest,
): Promise<void> => {
  const existing = await db.recurringRule.findFirst({
    where: { id },
    select: {
      id: true,
      type: true,
      accountId: true,
      frequency: true,
      interval: true,
      byMonthDay: true,
      byWeekday: true,
      byMonth: true,
      startDate: true,
      endDate: true,
      maxOccurrences: true,
      nextRunDate: true,
    },
  });

  if (existing === null) throw errors.notFound("No se encontró la regla");

  if (input.accountId !== undefined || input.categoryId !== undefined) {
    await validateReferences(
      db,
      input.accountId ?? existing.accountId,
      input.categoryId,
      existing.type as "INCOME" | "EXPENSE",
    );
  }

  const touchesPattern = PATTERN_FIELDS.some(
    (field) => input[field] !== undefined,
  );

  /**
   * Si cambió el patrón se reancla la serie. Las ocurrencias YA materializadas
   * no se tocan: son hechos económicos pasados y borrarlas al editar la regla
   * sería reescribir el historial.
   *
   * El nuevo `nextRunDate` no puede ser anterior al que ya había: si no, mover
   * la fecha de inicio hacia atrás haría que el job regenerara meses que ya
   * están cargados. El unique parcial los rechazaría, pero es mejor no llegar.
   */
  let nextRunDate: Date | undefined;

  if (touchesPattern) {
    const spec: RecurrenceSpec = {
      frequency: input.frequency ?? existing.frequency,
      interval: input.interval ?? existing.interval,
      startDate: input.startDate ?? toCalendarDate(existing.startDate),
      endDate:
        input.endDate !== undefined
          ? input.endDate
          : existing.endDate === null
            ? null
            : toCalendarDate(existing.endDate),
      maxOccurrences:
        input.maxOccurrences !== undefined
          ? input.maxOccurrences
          : existing.maxOccurrences,
      byMonthDay:
        input.byMonthDay !== undefined ? input.byMonthDay : existing.byMonthDay,
      byWeekday:
        input.byWeekday !== undefined ? input.byWeekday : existing.byWeekday,
      byMonth: input.byMonth !== undefined ? input.byMonth : existing.byMonth,
    };

    nextRunDate = fromCalendarDate(nextRunFor(spec));
  }

  await tx.recurringRule.update({
    where: { id },
    data: {
      ...(input.accountId !== undefined ? { accountId: input.accountId } : {}),
      ...(input.categoryId !== undefined
        ? { categoryId: input.categoryId }
        : {}),
      ...(input.amountMinor !== undefined
        ? { amountMinor: BigInt(input.amountMinor) }
        : {}),
      ...(input.description !== undefined
        ? { description: input.description }
        : {}),
      ...(input.payee !== undefined ? { payee: input.payee } : {}),
      ...(input.frequency !== undefined ? { frequency: input.frequency } : {}),
      ...(input.interval !== undefined ? { interval: input.interval } : {}),
      ...(input.byMonthDay !== undefined
        ? { byMonthDay: input.byMonthDay }
        : {}),
      ...(input.byWeekday !== undefined ? { byWeekday: input.byWeekday } : {}),
      ...(input.byMonth !== undefined ? { byMonth: input.byMonth } : {}),
      ...(input.startDate !== undefined
        ? { startDate: fromCalendarDate(input.startDate) }
        : {}),
      ...(input.endDate !== undefined
        ? {
            endDate:
              input.endDate === null ? null : fromCalendarDate(input.endDate),
          }
        : {}),
      ...(input.maxOccurrences !== undefined
        ? { maxOccurrences: input.maxOccurrences }
        : {}),
      ...(input.autoPost !== undefined ? { autoPost: input.autoPost } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      ...(nextRunDate !== undefined ? { nextRunDate } : {}),
    },
  });
};

/**
 * Borrado lógico de la regla. Las transacciones que ya generó se quedan:
 * son gastos reales y borrarlas descuadraría los saldos.
 *
 * Por eso mismo la FK es `onDelete: Restrict` — el borrado es lógico y la
 * relación sigue apuntando a una regla que existe, aunque esté marcada.
 */
export const deleteRecurringRule = async (
  db: ScopedDb,
  tx: TransactionClient,
  id: string,
): Promise<void> => {
  const existing = await db.recurringRule.findFirst({
    where: { id },
    select: { id: true },
  });
  if (existing === null) throw errors.notFound("No se encontró la regla");

  await tx.recurringRule.update({
    where: { id },
    data: { deletedAt: new Date(), isActive: false },
  });
};
