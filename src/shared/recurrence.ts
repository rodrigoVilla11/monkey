import {
  addDays,
  daysInMonth,
  fromCalendarDate,
  getWeekday,
  toCalendarDate,
  type CalendarDate,
} from "./dates";

/**
 * Motor de recurrencia. Lógica pura, sin base de datos ni reloj.
 *
 * Es un RRULE recortado a lo que una app de finanzas necesita de verdad: el
 * alquiler el día 1, el sueldo el último viernes, el seguro cada 12 de marzo.
 * Nada de BYSETPOS ni de excepciones: cada cosa que se agrega acá hay que
 * poder explicarla en una línea en la pantalla.
 *
 * ── La regla que evita el bug de deriva ──────────────────────────────────────
 *
 * Las ocurrencias se calculan SIEMPRE desde el ancla (la primera), nunca desde
 * la anterior. Con "cada mes el 31" y suma encadenada pasaría esto:
 *
 *   31 ene → +1 mes → 28 feb (saturado) → +1 mes → 28 mar → 28 abr …
 *
 * y la regla se mudaría sola al 28 para siempre. Calculando desde el ancla, el
 * 28 de febrero es solo la forma que toma el 31 en un mes que no lo tiene, y
 * marzo vuelve al 31.
 *
 * Módulo puro: sin Next, sin Prisma, sin React.
 */

export type RecurrenceFrequency = "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";

export interface RecurrenceSpec {
  readonly frequency: RecurrenceFrequency;
  /** Cada cuántos períodos. 1 = todos. */
  readonly interval: number;
  readonly startDate: CalendarDate;
  /** Última fecha admitida, inclusive. */
  readonly endDate?: CalendarDate | null;
  /** Tope de ocurrencias en total. */
  readonly maxOccurrences?: number | null;
  /** MONTHLY / YEARLY: día del mes (1..31). Se satura al último del mes. */
  readonly byMonthDay?: number | null;
  /** WEEKLY: 0 = domingo … 6 = sábado. */
  readonly byWeekday?: number | null;
  /** YEARLY: 1..12. */
  readonly byMonth?: number | null;
}

const partsOf = (value: CalendarDate): [number, number, number] => {
  const date = fromCalendarDate(value);
  return [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()];
};

const build = (year: number, month: number, day: number): CalendarDate =>
  toCalendarDate(
    new Date(
      Date.UTC(year, month - 1, Math.min(day, daysInMonth(year, month))),
    ),
  );

// ────────────────────────────── validación ───────────────────────────────────

/**
 * Errores de forma de la regla. Se devuelven como lista y no se tira: quien
 * llama decide si son un 400 de la API o un cartel en el formulario.
 */
export const validateRecurrence = (spec: RecurrenceSpec): string[] => {
  const errors: string[] = [];

  if (!Number.isInteger(spec.interval) || spec.interval < 1) {
    errors.push("El intervalo tiene que ser un entero mayor o igual a 1");
  }
  if (spec.interval > 365) {
    errors.push("El intervalo es demasiado grande");
  }

  if (spec.frequency === "WEEKLY" && spec.byWeekday != null) {
    if (
      !Number.isInteger(spec.byWeekday) ||
      spec.byWeekday < 0 ||
      spec.byWeekday > 6
    ) {
      errors.push("El día de la semana tiene que estar entre 0 y 6");
    }
  }

  if (spec.byMonthDay != null) {
    if (
      !Number.isInteger(spec.byMonthDay) ||
      spec.byMonthDay < 1 ||
      spec.byMonthDay > 31
    ) {
      errors.push("El día del mes tiene que estar entre 1 y 31");
    }
  }

  if (spec.byMonth != null) {
    if (
      !Number.isInteger(spec.byMonth) ||
      spec.byMonth < 1 ||
      spec.byMonth > 12
    ) {
      errors.push("El mes tiene que estar entre 1 y 12");
    }
  }

  if (spec.endDate != null && spec.endDate < spec.startDate) {
    errors.push("La fecha de fin no puede ser anterior a la de inicio");
  }

  if (
    spec.maxOccurrences != null &&
    (!Number.isInteger(spec.maxOccurrences) || spec.maxOccurrences < 1)
  ) {
    errors.push("El máximo de repeticiones tiene que ser mayor a 0");
  }

  return errors;
};

// ─────────────────────────────── ocurrencias ─────────────────────────────────

/**
 * La primera ocurrencia: la fecha en o después de `startDate` que encaja con el
 * patrón.
 *
 * Es el ancla de todo lo demás. Si el patrón no aplica a `startDate` —arranca
 * un martes una regla de los viernes— avanza hasta la primera que sí.
 */
export const firstOccurrence = (spec: RecurrenceSpec): CalendarDate => {
  const [year, month, day] = partsOf(spec.startDate);

  switch (spec.frequency) {
    case "DAILY":
      return spec.startDate;

    case "WEEKLY": {
      if (spec.byWeekday == null) return spec.startDate;
      const diff = (spec.byWeekday - getWeekday(spec.startDate) + 7) % 7;
      return addDays(spec.startDate, diff);
    }

    case "MONTHLY": {
      if (spec.byMonthDay == null) return spec.startDate;
      const candidate = build(year, month, spec.byMonthDay);
      // Si el día ya pasó en el mes de inicio, la primera es la del mes que viene.
      return candidate >= spec.startDate
        ? candidate
        : monthlyFrom(year, month, spec.byMonthDay, 1);
    }

    case "YEARLY": {
      const targetMonth = spec.byMonth ?? month;
      const targetDay = spec.byMonthDay ?? day;
      const candidate = build(year, targetMonth, targetDay);
      return candidate >= spec.startDate
        ? candidate
        : build(year + 1, targetMonth, targetDay);
    }
  }
};

const monthlyFrom = (
  year: number,
  month: number,
  day: number,
  monthsToAdd: number,
): CalendarDate => {
  const total = year * 12 + (month - 1) + monthsToAdd;
  return build(Math.floor(total / 12), (total % 12) + 1, day);
};

/**
 * La ocurrencia número `index` (0 = la primera), sin tener en cuenta `endDate`
 * ni `maxOccurrences`.
 *
 * Se calcula desde el ancla, que es lo que evita la deriva descrita arriba.
 */
export const occurrenceAt = (
  spec: RecurrenceSpec,
  index: number,
): CalendarDate => {
  const anchor = firstOccurrence(spec);
  if (index <= 0) return anchor;

  const [year, month, day] = partsOf(anchor);

  switch (spec.frequency) {
    case "DAILY":
      return addDays(anchor, index * spec.interval);

    case "WEEKLY":
      return addDays(anchor, index * spec.interval * 7);

    case "MONTHLY":
      // El día deseado es el del ancla, salvo que la regla fije otro. Usar el
      // del ancla y no el de la ocurrencia previa es lo que devuelve el 31
      // después de un febrero.
      return monthlyFrom(
        year,
        month,
        spec.byMonthDay ?? day,
        index * spec.interval,
      );

    case "YEARLY":
      return monthlyFrom(
        year,
        month,
        spec.byMonthDay ?? day,
        index * spec.interval * 12,
      );
  }
};

/**
 * La ocurrencia siguiente a `previous`, o `null` si la regla ya terminó.
 *
 * El índice se deduce de `previous` en vez de llevarse en un contador aparte:
 * si alguien edita la regla, el contador quedaría mintiendo y las fechas
 * empezarían a salir de otro lado.
 */
export const nextOccurrence = (
  spec: RecurrenceSpec,
  previous: CalendarDate,
): CalendarDate | null => {
  const anchor = firstOccurrence(spec);
  if (previous < anchor) return withinBounds(spec, anchor, 0);

  const index = indexOf(spec, previous);
  return withinBounds(spec, occurrenceAt(spec, index + 1), index + 1);
};

/** Cuántas ocurrencias completas hay entre el ancla y `value`. */
const indexOf = (spec: RecurrenceSpec, value: CalendarDate): number => {
  const anchor = firstOccurrence(spec);
  const [anchorYear, anchorMonth] = partsOf(anchor);
  const [year, month] = partsOf(value);

  switch (spec.frequency) {
    case "DAILY":
      return Math.floor(daysBetween(anchor, value) / spec.interval);
    case "WEEKLY":
      return Math.floor(daysBetween(anchor, value) / (spec.interval * 7));
    case "MONTHLY":
      return Math.floor(
        (year * 12 + month - (anchorYear * 12 + anchorMonth)) / spec.interval,
      );
    case "YEARLY":
      return Math.floor((year - anchorYear) / spec.interval);
  }
};

const daysBetween = (a: CalendarDate, b: CalendarDate): number =>
  Math.round(
    (fromCalendarDate(b).getTime() - fromCalendarDate(a).getTime()) /
      86_400_000,
  );

/** Aplica `endDate` y `maxOccurrences`. */
const withinBounds = (
  spec: RecurrenceSpec,
  candidate: CalendarDate,
  index: number,
): CalendarDate | null => {
  if (spec.endDate != null && candidate > spec.endDate) return null;
  if (spec.maxOccurrences != null && index >= spec.maxOccurrences) return null;
  return candidate;
};

/**
 * Todas las ocurrencias desde `from` (inclusive) hasta `until` (inclusive).
 *
 * `limit` es un tope duro y su función es concreta: si el job estuvo caído
 * meses, una regla diaria tendría cientos de ocurrencias vencidas. Se
 * materializan las primeras `limit` y el resto queda para la corrida
 * siguiente — nunca se saltean, porque cada una es plata que se movió de
 * verdad. `truncated` avisa que quedaron afuera.
 */
export interface OccurrenceWindow {
  readonly dates: readonly CalendarDate[];
  readonly truncated: boolean;
  /** La que sigue después de la última devuelta, o null si la regla terminó. */
  readonly next: CalendarDate | null;
}

export const occurrencesUpTo = (
  spec: RecurrenceSpec,
  from: CalendarDate,
  until: CalendarDate,
  limit: number,
): OccurrenceWindow => {
  const dates: CalendarDate[] = [];

  const anchor = firstOccurrence(spec);
  let index = from <= anchor ? 0 : Math.max(0, indexOf(spec, from));
  let current: CalendarDate | null = withinBounds(
    spec,
    occurrenceAt(spec, index),
    index,
  );

  // Si el índice deducido cae justo antes de `from`, se avanza uno.
  while (current !== null && current < from) {
    index += 1;
    current = withinBounds(spec, occurrenceAt(spec, index), index);
  }

  while (current !== null && current <= until) {
    if (dates.length >= limit) {
      return { dates, truncated: true, next: current };
    }
    dates.push(current);
    index += 1;
    current = withinBounds(spec, occurrenceAt(spec, index), index);
  }

  return { dates, truncated: false, next: current };
};

// ────────────────────────────── presentación ─────────────────────────────────

const WEEKDAYS = [
  "domingo",
  "lunes",
  "martes",
  "miércoles",
  "jueves",
  "viernes",
  "sábado",
] as const;

const MONTHS = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
] as const;

/**
 * La regla en una línea, para la pantalla.
 *
 * Vive acá y no en un componente porque el cliente nativo va a necesitar la
 * misma frase, y porque una regla que no se puede describir en una línea es
 * una regla que no debería existir.
 */
export const describeRecurrence = (spec: RecurrenceSpec): string => {
  const every = spec.interval === 1;
  const n = String(spec.interval);

  switch (spec.frequency) {
    case "DAILY":
      return every ? "Todos los días" : `Cada ${n} días`;

    case "WEEKLY": {
      const index = spec.byWeekday ?? getWeekday(spec.startDate);
      const weekday = WEEKDAYS[index] ?? "día";
      return every
        ? `Todos los ${weekday}`
        : `Cada ${n} semanas, los ${weekday}`;
    }

    case "MONTHLY": {
      const day = spec.byMonthDay ?? partsOf(spec.startDate)[2];
      // Avisar del recorte importa: que en febrero caiga el 28 no puede ser
      // una sorpresa para quien programó el 31.
      const label =
        day > 28 ? `${String(day)} (o el último del mes)` : String(day);
      return every
        ? `Todos los meses el día ${label}`
        : `Cada ${n} meses el día ${label}`;
    }

    case "YEARLY": {
      const [, startMonth, startDay] = partsOf(spec.startDate);
      const month = MONTHS[(spec.byMonth ?? startMonth) - 1] ?? "";
      const day = String(spec.byMonthDay ?? startDay);
      return every
        ? `Todos los años el ${day} de ${month}`
        : `Cada ${n} años el ${day} de ${month}`;
    }
  }
};
