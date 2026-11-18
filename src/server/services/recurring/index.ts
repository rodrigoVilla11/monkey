import { errors } from "@/server/api/errors";
import type { ScopedDb } from "@/server/db/scoped";
import type { TransactionClient } from "@/server/services/audit/log";
import {
  NO_ACCOUNT_AUTOPOST_MESSAGE,
  type CreateRecurringRuleRequest,
  type RecurringRuleDTO,
  type RecurringRuleFilters,
  type UpdateRecurringRuleRequest,
} from "@/shared/contracts/recurring";
import {
  fromCalendarDate,
  toCalendarDate,
  type CalendarDate,
} from "@/shared/dates";
import {
  describeRecurrence,
  firstOccurrence,
  occurrencesUpTo,
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
 * patrón. Se hace en un solo lugar, `reanchor`, y hay un test que verifica
 * que editar una regla no desplace la serie ni vuelva atrás.
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
  } | null;
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
 *
 * Sin cuenta (`null`) no hay nada que verificar de ese lado y la moneda la
 * decide quien llama.
 */
const validateReferences = async (
  db: ScopedDb,
  accountId: string | null,
  categoryId: string | null | undefined,
  type: "INCOME" | "EXPENSE",
): Promise<{ currency: string | null }> => {
  let currency: string | null = null;

  if (accountId !== null) {
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
    currency = account.currency;
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

  return { currency };
};

/**
 * `nextRunDate` de una regla recién creada.
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

/**
 * `nextRunDate` de una regla cuyo patrón cambió.
 *
 * Es la primera ocurrencia del patrón NUEVO que no sea anterior al próximo
 * vencimiento que ya tenía. Las ocurrencias ya materializadas no se tocan: son
 * hechos económicos pasados. Y la serie no vuelve atrás: si el nuevo
 * `nextRunDate` fuera la primera ocurrencia del patrón, mover el día del mes
 * de una regla con un año de historia la haría "revencer" doce veces; el
 * unique parcial descartaría las filas, pero `occurrencesCreated` las
 * contaría igual y una regla con tope se cerraría antes de tiempo.
 *
 * `null` si el patrón nuevo no tiene ninguna ocurrencia por delante (la fecha
 * de fin quedó en el pasado): la regla terminó.
 */
const reanchor = (
  spec: RecurrenceSpec,
  notBefore: CalendarDate,
): CalendarDate | null => {
  const problems = validateRecurrence(spec);
  if (problems.length > 0) {
    throw errors.validation({ recurrence: problems });
  }
  const window = occurrencesUpTo(spec, notBefore, notBefore, 1);
  return window.dates[0] ?? window.next;
};

export const createRecurringRule = async (
  db: ScopedDb,
  tx: TransactionClient,
  space: { readonly spaceId: string; readonly primaryCurrency: string },
  actor: { readonly userId: string; readonly name: string },
  input: CreateRecurringRuleRequest,
): Promise<string> => {
  const accountId = input.accountId ?? null;

  // El contrato ya lo rechaza; acá se vuelve a mirar porque el service es el
  // último que decide antes de la base, y la base tiene el CHECK.
  if (accountId === null && input.autoPost) {
    throw errors.conflict("UNPROCESSABLE", NO_ACCOUNT_AUTOPOST_MESSAGE);
  }

  const { currency: accountCurrency } = await validateReferences(
    db,
    accountId,
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
      accountId,
      categoryId: input.categoryId ?? null,
      createdByUserId: actor.userId,
      createdByName: actor.name,
      type: input.type,
      amountMinor: BigInt(input.amountMinor),
      // Sin cuenta no hay de dónde tomar la moneda: la primaria del Space.
      currency: input.currency ?? accountCurrency ?? space.primaryCurrency,
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
      currency: true,
      autoPost: true,
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

  const type = existing.type as "INCOME" | "EXPENSE";
  const accountId =
    input.accountId !== undefined ? input.accountId : existing.accountId;
  const autoPost = input.autoPost ?? existing.autoPost;

  // La regla RESULTANTE es la que no puede quedar sin cuenta y dada por hecha.
  if (accountId === null && autoPost) {
    throw errors.conflict("UNPROCESSABLE", NO_ACCOUNT_AUTOPOST_MESSAGE);
  }

  if (input.accountId !== undefined || input.categoryId !== undefined) {
    const { currency } = await validateReferences(
      db,
      accountId,
      input.categoryId,
      type,
    );

    /**
     * Cambiar a una cuenta en otra moneda dejaría un importe en euros
     * asentándose en pesos. La moneda de la regla no se edita —cambiarla
     * redefiniría lo que significa el importe—, así que la cuenta tiene que
     * estar en la misma.
     */
    if (
      input.accountId != null &&
      currency !== null &&
      currency !== existing.currency
    ) {
      throw errors.conflict(
        "UNPROCESSABLE",
        `La cuenta está en ${currency} y el programado en ${existing.currency}`,
      );
    }
  }

  const touchesPattern = PATTERN_FIELDS.some(
    (field) => input[field] !== undefined,
  );

  let nextRunDate: Date | undefined;
  let finished = false;

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

    const next = reanchor(spec, toCalendarDate(existing.nextRunDate));
    if (next === null) finished = true;
    else nextRunDate = fromCalendarDate(next);
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
      // Un patrón sin ocurrencias por delante termina la regla acá mismo, en
      // vez de dejarla activa hasta que el job la encuentre.
      ...(finished
        ? { isActive: false }
        : input.isActive !== undefined
          ? { isActive: input.isActive }
          : {}),
      ...(nextRunDate !== undefined ? { nextRunDate } : {}),
    },
  });
};

/**
 * Qué cuenta usar para aceptar las ocurrencias vencidas de una regla.
 *
 * Con cuenta en la regla, esa; lo que venga en el pedido se ignora. Sin
 * cuenta, la que se elige ahora: tiene que ser del Space, estar en uso y en la
 * moneda del programado —el importe no se convierte al aceptar.
 */
export const resolveAcceptAccount = async (
  db: ScopedDb,
  ruleId: string,
  requestedAccountId: string | undefined,
): Promise<{ accountId: string | undefined }> => {
  const rule = await db.recurringRule.findFirst({
    where: { id: ruleId },
    select: { accountId: true, currency: true },
  });
  if (rule === null) throw errors.notFound("No se encontró la regla");

  if (rule.accountId !== null) return { accountId: undefined };

  if (requestedAccountId === undefined) {
    throw errors.conflict(
      "UNPROCESSABLE",
      "Este programado no tiene cuenta: elegí de qué cuenta salió para aceptarlo",
    );
  }

  const account = await db.account.findFirst({
    where: { id: requestedAccountId },
    select: { currency: true, isArchived: true },
  });
  if (account === null) throw errors.notFound("No se encontró la cuenta");
  if (account.isArchived) {
    throw errors.conflict("CONFLICT", "Esa cuenta está archivada");
  }
  if (account.currency !== rule.currency) {
    throw errors.conflict(
      "UNPROCESSABLE",
      `La cuenta está en ${account.currency} y el programado en ${rule.currency}`,
    );
  }

  return { accountId: requestedAccountId };
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
