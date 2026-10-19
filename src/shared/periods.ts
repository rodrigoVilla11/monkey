import {
  addDays,
  addMonths,
  addYears,
  differenceInDays,
  endOfMonth,
  endOfYear,
  formatCalendarDate,
  lastMonths,
  maxCalendarDate,
  minCalendarDate,
  monthRange,
  startOfMonth,
  startOfWeek,
  startOfYear,
  weekRange,
  type CalendarDate,
  type DateRange,
} from "./dates";

/**
 * Períodos de los reportes.
 *
 * Un reporte se pide siempre con un rango [start, end] inclusivo. Lo que vive
 * acá es todo lo que se deriva de ese rango sin tocar la base: los atajos
 * ("este mes", "últimos 3 meses"), cómo se corre hacia atrás y adelante, con
 * qué período se compara y en qué cortes se dibuja la serie.
 *
 * La UI y el servidor usan las mismas funciones: así "el período anterior"
 * significa exactamente lo mismo en la pantalla y en la consulta.
 *
 * Módulo puro: sin Next, sin Prisma, sin React.
 */

export const PERIOD_PRESETS = [
  "this-week",
  "last-week",
  "this-month",
  "last-month",
  "last-3-months",
  "last-6-months",
  "last-12-months",
  "this-year",
  "last-year",
] as const;

export type PeriodPreset = (typeof PERIOD_PRESETS)[number];

/**
 * Tope de un rango: 36 meses. Más no se lee en un teléfono, y la serie se
 * vuelve una consulta larga para dibujar una línea plana.
 */
export const MAX_RANGE_MONTHS = 36;

// ──────────────────────────────── rangos ─────────────────────────────────────

/** Los últimos N meses completos, el actual incluido. */
export const lastMonthsRange = (
  today: CalendarDate,
  count: number,
): DateRange => {
  const months = lastMonths(today, count);
  const first = months[0] ?? monthRange(today);
  const last = months.at(-1) ?? first;
  return { start: first.start, end: last.end };
};

/**
 * El rango de un atajo. `weekStartsOn` es la preferencia del usuario
 * (0 = domingo … 6 = sábado) y solo importa en los atajos semanales.
 */
export const presetRange = (
  preset: PeriodPreset,
  today: CalendarDate,
  weekStartsOn = 1,
): DateRange => {
  switch (preset) {
    case "this-week":
      return weekRange(today, weekStartsOn);
    case "last-week":
      return weekRange(addDays(today, -7), weekStartsOn);
    case "this-month":
      return monthRange(today);
    case "last-month":
      return monthRange(addMonths(startOfMonth(today), -1));
    case "last-3-months":
      return lastMonthsRange(today, 3);
    case "last-6-months":
      return lastMonthsRange(today, 6);
    case "last-12-months":
      return lastMonthsRange(today, 12);
    case "this-year":
      return { start: startOfYear(today), end: endOfYear(today) };
    case "last-year": {
      const lastYear = addYears(today, -1);
      return { start: startOfYear(lastYear), end: endOfYear(lastYear) };
    }
  }
};

export const sameRange = (a: DateRange, b: DateRange): boolean =>
  a.start === b.start && a.end === b.end;

/** Las fechas ISO se comparan como texto: es lo que las hace cómodas. */
export const isOrderedRange = (range: DateRange): boolean =>
  range.start <= range.end;

/** Empieza el día 1 y termina el último día de un mes: uno o varios enteros. */
export const isWholeMonths = (range: DateRange): boolean =>
  range.start === startOfMonth(range.start) &&
  range.end === endOfMonth(range.end);

export const isSingleMonth = (range: DateRange): boolean =>
  isWholeMonths(range) && range.start.slice(0, 7) === range.end.slice(0, 7);

export const isWholeYear = (range: DateRange): boolean =>
  range.start === startOfYear(range.start) &&
  range.end === endOfYear(range.start);

const yearMonth = (value: CalendarDate): [number, number] => [
  Number(value.slice(0, 4)),
  Number(value.slice(5, 7)),
];

/** Meses que toca el rango, contando el del inicio y el del fin. */
export const monthSpan = (range: DateRange): number => {
  const [startYear, startMonth] = yearMonth(range.start);
  const [endYear, endMonth] = yearMonth(range.end);
  return (endYear - startYear) * 12 + (endMonth - startMonth) + 1;
};

export const dayCount = (range: DateRange): number =>
  differenceInDays(range.start, range.end) + 1;

export const exceedsMaxRange = (range: DateRange): boolean =>
  monthSpan(range) > MAX_RANGE_MONTHS;

/**
 * Corre el rango su propio largo hacia atrás o adelante.
 *
 * Si son meses enteros se corre en meses —ene–mar pasa a abr–jun, y un mes
 * de 31 días pasa al siguiente aunque tenga 30—; si no, en días. Es lo que
 * hacen las flechas del selector y lo que define "el período anterior" de la
 * comparativa, así que las dos cosas coinciden por construcción.
 */
export const shiftRange = (range: DateRange, direction: -1 | 1): DateRange => {
  if (isWholeMonths(range)) {
    const months = monthSpan(range) * direction;
    return {
      start: startOfMonth(addMonths(range.start, months)),
      end: endOfMonth(addMonths(range.end, months)),
    };
  }

  const days = dayCount(range) * direction;
  return { start: addDays(range.start, days), end: addDays(range.end, days) };
};

export const previousRange = (range: DateRange): DateRange =>
  shiftRange(range, -1);

/**
 * El mismo rango un año atrás: octubre contra octubre del año pasado.
 * Meses enteros se corren doce meses; un rango suelto, un año por extremo
 * (el 29 de febrero satura al 28).
 */
export const sameRangeLastYear = (range: DateRange): DateRange =>
  isWholeMonths(range)
    ? {
        start: startOfMonth(addMonths(range.start, -12)),
        end: endOfMonth(addMonths(range.end, -12)),
      }
    : { start: addYears(range.start, -1), end: addYears(range.end, -1) };

/**
 * Si tiene sentido avanzar al período siguiente.
 *
 * Meses enteros pueden pisar el mes en curso: "este mes" es un período válido
 * aunque no haya terminado. Un rango suelto solo avanza sobre días que ya
 * pasaron; si no, del 1 al 15 se saltaría a un 16–30 que es casi todo futuro
 * y la flecha siguiente quedaría bloqueada a mitad de camino.
 */
export const canStepForward = (
  range: DateRange,
  today: CalendarDate,
): boolean => {
  const next = shiftRange(range, 1);
  return isWholeMonths(range) ? next.start <= today : next.end <= today;
};

/**
 * El rango que pide una query, o el que corresponde por defecto. Un extremo
 * solo nunca llega acá: el contrato lo rechaza antes.
 */
export const rangeFromQuery = (
  query: {
    readonly from?: string | undefined;
    readonly to?: string | undefined;
  },
  fallback: () => DateRange,
): DateRange =>
  query.from !== undefined && query.to !== undefined
    ? { start: query.from, end: query.to }
    : fallback();

// ─────────────────────────────── cortes ──────────────────────────────────────

export type SeriesGranularity = "day" | "week" | "month";

export const SERIES_GRANULARITIES: readonly SeriesGranularity[] = [
  "day",
  "week",
  "month",
];

/**
 * Con qué corte se dibuja una serie según el largo del rango.
 *
 * Un mes se ve por día: es la única forma de ver cómo se fue gastando. De ahí
 * hasta unas 18 semanas, por semana: tres meses en tres barras no cuentan
 * nada y en 90 barras no entran. Más largo, por mes.
 */
export const granularityFor = (range: DateRange): SeriesGranularity => {
  const days = dayCount(range);
  if (days <= 31) return "day";
  if (days <= 126) return "week";
  return "month";
};

/**
 * Qué cortes se pueden elegir a mano para un rango. El automático siempre
 * está entre ellos. Por día hasta tres meses y por semana hasta un año: más
 * puntos no entran en un teléfono. Por mes solo si hay al menos dos.
 */
export const allowedGranularities = (
  range: DateRange,
): readonly SeriesGranularity[] => {
  const days = dayCount(range);
  const allowed: SeriesGranularity[] = [];
  if (days <= 92) allowed.push("day");
  if (days <= 371) allowed.push("week");
  if (monthSpan(range) >= 2 || days > 371) allowed.push("month");
  return allowed;
};

export interface SeriesBucket extends DateRange {
  /** "YYYY-MM" por mes; la fecha de inicio por día y por semana. */
  readonly key: string;
}

const bucketEnd = (
  date: CalendarDate,
  granularity: SeriesGranularity,
  weekStartsOn: number,
): CalendarDate => {
  switch (granularity) {
    case "day":
      return date;
    case "week":
      return addDays(startOfWeek(date, weekStartsOn), 6);
    case "month":
      return endOfMonth(date);
  }
};

const bucketKey = (
  start: CalendarDate,
  granularity: SeriesGranularity,
): string => (granularity === "month" ? start.slice(0, 7) : start);

/**
 * Los cortes de un rango, del más viejo al más nuevo, sin huecos.
 *
 * El primero y el último se recortan al rango: un rango que arranca un
 * miércoles tiene una primera "semana" de cinco días, no una que empieza
 * antes de lo pedido. La clave del corte recortado es su inicio real.
 */
export const bucketsFor = (
  range: DateRange,
  granularity: SeriesGranularity,
  weekStartsOn: number,
): SeriesBucket[] => {
  const buckets: SeriesBucket[] = [];
  let cursor = range.start;

  while (cursor <= range.end) {
    const end = minCalendarDate(
      bucketEnd(cursor, granularity, weekStartsOn),
      range.end,
    );
    buckets.push({ key: bucketKey(cursor, granularity), start: cursor, end });
    cursor = addDays(end, 1);
  }

  return buckets;
};

/**
 * A qué corte pertenece un día. Es la misma regla que `bucketsFor`, vista
 * desde el dato: el `max` con el inicio del rango es lo que manda los días de
 * la primera semana recortada a su clave real.
 */
export const bucketKeyFor = (
  date: CalendarDate,
  range: DateRange,
  granularity: SeriesGranularity,
  weekStartsOn: number,
): string => {
  switch (granularity) {
    case "day":
      return date;
    case "week":
      return maxCalendarDate(startOfWeek(date, weekStartsOn), range.start);
    case "month":
      return date.slice(0, 7);
  }
};

// ───────────────────────────── presentación ──────────────────────────────────

const capitalize = (value: string, locale: string): string =>
  value.charAt(0).toLocaleUpperCase(locale) + value.slice(1);

/** Etiqueta corta de un corte, para el eje del gráfico. */
export const bucketLabel = (
  bucket: DateRange,
  granularity: SeriesGranularity,
  locale: string,
): string =>
  granularity === "month"
    ? formatCalendarDate(bucket.start, locale, {
        month: "short",
        year: "2-digit",
      })
    : formatCalendarDate(bucket.start, locale, {
        day: "numeric",
        month: "short",
      });

const dayTitle = (date: CalendarDate, locale: string): string =>
  capitalize(
    formatCalendarDate(date, locale, {
      weekday: "short",
      day: "numeric",
      month: "short",
    }),
    locale,
  );

/** Nombre completo de un corte, para la tabla y el detalle. */
export const bucketTitle = (
  bucket: DateRange,
  granularity: SeriesGranularity,
  locale: string,
): string => {
  switch (granularity) {
    case "month":
      return capitalize(
        formatCalendarDate(bucket.start, locale, {
          month: "long",
          year: "numeric",
        }),
        locale,
      );
    case "day":
      return dayTitle(bucket.start, locale);
    case "week": {
      // Una semana recortada a un solo día se nombra como día, no "9 nov – 9 nov".
      if (bucket.start === bucket.end) return dayTitle(bucket.start, locale);
      // Si cruza el año, los dos extremos lo dicen: "29 dic 2025 – 4 ene 2026".
      const crossesYear = bucket.start.slice(0, 4) !== bucket.end.slice(0, 4);
      const options: Intl.DateTimeFormatOptions = crossesYear
        ? { day: "numeric", month: "short", year: "numeric" }
        : { day: "numeric", month: "short" };
      return `${formatCalendarDate(bucket.start, locale, options)} – ${formatCalendarDate(bucket.end, locale, options)}`;
    }
  }
};

/**
 * Cómo se nombra un rango: "Octubre de 2026", "2026", "ene – mar 2026",
 * "6 oct – 19 oct 2026". Lo más corto que no deje dudas.
 */
export const describeRange = (range: DateRange, locale: string): string => {
  if (isSingleMonth(range)) {
    return capitalize(
      formatCalendarDate(range.start, locale, {
        month: "long",
        year: "numeric",
      }),
      locale,
    );
  }

  if (isWholeYear(range)) return range.start.slice(0, 4);

  const sameYear = range.start.slice(0, 4) === range.end.slice(0, 4);

  if (isWholeMonths(range)) {
    const start = formatCalendarDate(
      range.start,
      locale,
      sameYear ? { month: "short" } : { month: "short", year: "numeric" },
    );
    const end = formatCalendarDate(range.end, locale, {
      month: "short",
      year: "numeric",
    });
    return `${start} – ${end}`;
  }

  const start = formatCalendarDate(
    range.start,
    locale,
    sameYear
      ? { day: "numeric", month: "short" }
      : { day: "numeric", month: "short", year: "numeric" },
  );
  const end = formatCalendarDate(range.end, locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  return `${start} – ${end}`;
};
