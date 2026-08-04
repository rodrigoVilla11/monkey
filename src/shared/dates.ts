/**
 * Fechas.
 *
 * La app maneja dos cosas distintas que conviene no mezclar nunca:
 *
 *  1. **CalendarDate** — "el 3 de agosto". Un hecho local sin hora ni huso.
 *     Es lo que lleva `Transaction.date` (@db.Date). Se representa como
 *     "YYYY-MM-DD".
 *  2. **Instant** — un momento absoluto (`createdAt`, `lastUsedAt`). Es un
 *     `Date`/timestamptz y se muestra en la timezone de quien mira.
 *
 * Confundirlos es el bug clásico: una transacción cargada a las 23:30 en
 * Madrid que aparece al día siguiente porque alguien la guardó como instante
 * y la leyó en UTC.
 *
 * La aritmética de CalendarDate se hace con UTC explícito en vez de con
 * date-fns porque date-fns opera en la timezone LOCAL del proceso: en un
 * contenedor en UTC y en un iPhone en Madrid, `addMonths` sobre la misma
 * fecha puede dar días distintos. Son pocas líneas y quedan exactas y
 * testeadas. date-fns se usa para lo que sí aporta: formatear instantes.
 *
 * Módulo puro: sin Next, sin Prisma, sin React.
 */

/** Fecha calendario en formato ISO "YYYY-MM-DD". */
export type CalendarDate = string;

const CALENDAR_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export const isCalendarDate = (value: string): value is CalendarDate => {
  const match = CALENDAR_DATE_RE.exec(value);
  if (!match) return false;

  const [, y = "", m = "", d = ""] = match;
  const year = Number(y);
  const month = Number(m);
  const day = Number(d);

  if (month < 1 || month > 12) return false;
  if (day < 1 || day > daysInMonth(year, month)) return false;
  return true;
};

const pad = (value: number, length = 2): string =>
  value.toString().padStart(length, "0");

export const daysInMonth = (year: number, month: number): number =>
  new Date(Date.UTC(year, month, 0)).getUTCDate();

export const isLeapYear = (year: number): boolean =>
  (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

// ─────────────────────── conversión con Date (UTC) ───────────────────────────

/**
 * Prisma devuelve las columnas @db.Date como Date a medianoche UTC.
 * Se leen los componentes UTC, nunca los locales.
 */
export const toCalendarDate = (date: Date): CalendarDate =>
  `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;

/** Date a medianoche UTC. Es lo que espera Prisma para una columna @db.Date. */
export const fromCalendarDate = (value: CalendarDate): Date => {
  const match = CALENDAR_DATE_RE.exec(value);
  if (!match) throw new RangeError(`CalendarDate inválida: ${value}`);
  const [, y = "", m = "", d = ""] = match;
  return new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
};

const parts = (value: CalendarDate): [number, number, number] => {
  const match = CALENDAR_DATE_RE.exec(value);
  if (!match) throw new RangeError(`CalendarDate inválida: ${value}`);
  const [, y = "", m = "", d = ""] = match;
  return [Number(y), Number(m), Number(d)];
};

const build = (year: number, month: number, day: number): CalendarDate =>
  toCalendarDate(new Date(Date.UTC(year, month - 1, day)));

// ─────────────────────────────── "hoy" ───────────────────────────────────────

/**
 * Qué día es hoy para alguien en `timeZone`.
 *
 * Es lo que precarga el formulario de carga rápida. Sin esto, a las 00:30 en
 * Madrid el server en UTC propondría el día anterior.
 *
 * Se usa el locale "en-CA" porque su formato numérico ES "YYYY-MM-DD".
 */
export const todayIn = (
  timeZone: string,
  now: Date = new Date(),
): CalendarDate => {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
  } catch {
    return toCalendarDate(now);
  }
};

export const isValidTimeZone = (timeZone: string): boolean => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
};

// ────────────────────────────── aritmética ───────────────────────────────────

export const addDays = (value: CalendarDate, days: number): CalendarDate => {
  const [year, month, day] = parts(value);
  return build(year, month, day + days);
};

/**
 * Suma meses saturando el día al último del mes destino.
 * 31 de enero + 1 mes = 28 de febrero, no 3 de marzo. Es lo que espera
 * cualquiera con un gasto recurrente el día 31.
 */
export const addMonths = (
  value: CalendarDate,
  months: number,
): CalendarDate => {
  const [year, month, day] = parts(value);

  const totalMonths = year * 12 + (month - 1) + months;
  const targetYear = Math.floor(totalMonths / 12);
  const targetMonth = (totalMonths % 12) + 1;

  return build(
    targetYear,
    targetMonth,
    Math.min(day, daysInMonth(targetYear, targetMonth)),
  );
};

export const addYears = (value: CalendarDate, years: number): CalendarDate =>
  addMonths(value, years * 12);

/** Días calendario entre dos fechas (b − a). */
export const differenceInDays = (a: CalendarDate, b: CalendarDate): number => {
  const MS_PER_DAY = 86_400_000;
  return Math.round(
    (fromCalendarDate(b).getTime() - fromCalendarDate(a).getTime()) /
      MS_PER_DAY,
  );
};

export const compareCalendarDates = (
  a: CalendarDate,
  b: CalendarDate,
): number => (a < b ? -1 : a > b ? 1 : 0);

export const minCalendarDate = (
  a: CalendarDate,
  b: CalendarDate,
): CalendarDate => (a <= b ? a : b);

export const maxCalendarDate = (
  a: CalendarDate,
  b: CalendarDate,
): CalendarDate => (a >= b ? a : b);

// ─────────────────────────────── períodos ────────────────────────────────────

/** Rango [start, end] inclusivo. Es la forma en que se piden todos los reportes. */
export interface DateRange {
  readonly start: CalendarDate;
  readonly end: CalendarDate;
}

export const startOfMonth = (value: CalendarDate): CalendarDate => {
  const [year, month] = parts(value);
  return build(year, month, 1);
};

export const endOfMonth = (value: CalendarDate): CalendarDate => {
  const [year, month] = parts(value);
  return build(year, month, daysInMonth(year, month));
};

export const monthRange = (value: CalendarDate): DateRange => ({
  start: startOfMonth(value),
  end: endOfMonth(value),
});

/** 0 = domingo … 6 = sábado. Mismo criterio que `User.weekStartsOn`. */
export const getWeekday = (value: CalendarDate): number =>
  fromCalendarDate(value).getUTCDay();

export const startOfWeek = (
  value: CalendarDate,
  weekStartsOn: number,
): CalendarDate => {
  const current = getWeekday(value);
  const diff = (current - weekStartsOn + 7) % 7;
  return addDays(value, -diff);
};

export const weekRange = (
  value: CalendarDate,
  weekStartsOn: number,
): DateRange => {
  const start = startOfWeek(value, weekStartsOn);
  return { start, end: addDays(start, 6) };
};

export const startOfYear = (value: CalendarDate): CalendarDate =>
  build(parts(value)[0], 1, 1);

export const endOfYear = (value: CalendarDate): CalendarDate =>
  build(parts(value)[0], 12, 31);

export const isWithin = (value: CalendarDate, range: DateRange): boolean =>
  value >= range.start && value <= range.end;

/**
 * Los N meses hasta `value` inclusive, del más viejo al más nuevo.
 * Es el eje X de los reportes de evolución mensual.
 */
export const lastMonths = (value: CalendarDate, count: number): DateRange[] => {
  const ranges: DateRange[] = [];
  for (let offset = count - 1; offset >= 0; offset -= 1) {
    ranges.push(monthRange(addMonths(value, -offset)));
  }
  return ranges;
};

// ────────────────────────────── presentación ─────────────────────────────────

/** "3 de agosto de 2026" o lo que corresponda al locale. */
export const formatCalendarDate = (
  value: CalendarDate,
  locale: string,
  options: Intl.DateTimeFormatOptions = { dateStyle: "long" },
): string => {
  try {
    return new Intl.DateTimeFormat(locale, {
      ...options,
      // La fecha se construyó a medianoche UTC: hay que leerla en UTC o
      // se corre un día en husos negativos.
      timeZone: "UTC",
    }).format(fromCalendarDate(value));
  } catch {
    return value;
  }
};

/** Un instante (createdAt) mostrado en la timezone de quien mira. */
export const formatInstant = (
  instant: Date,
  timeZone: string,
  locale: string,
  options: Intl.DateTimeFormatOptions = {
    dateStyle: "medium",
    timeStyle: "short",
  },
): string => {
  try {
    return new Intl.DateTimeFormat(locale, { ...options, timeZone }).format(
      instant,
    );
  } catch {
    return instant.toISOString();
  }
};
