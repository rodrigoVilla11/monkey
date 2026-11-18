import writeXlsxFile, { type Row, type Sheet } from "write-excel-file/node";

import type { ScopedDb } from "@/server/db/scoped";
import type { ExportQuery } from "@/shared/contracts/import-export";
import { getCurrencyExponent } from "@/shared/currency";
import {
  fromCalendarDate,
  monthRange,
  toCalendarDate,
  todayIn,
  type CalendarDate,
  type DateRange,
} from "@/shared/dates";
import { money, toDecimalString } from "@/shared/money";
import {
  bucketKeyFor,
  bucketsFor,
  bucketTitle,
  describeRange,
  granularityFor,
  type SeriesGranularity,
} from "@/shared/periods";

/**
 * Exportación a Excel.
 *
 * El CSV (`export.ts`) es una tabla plana para reimportar. Esto es otra cosa:
 * un libro para MIRAR, con los movimientos en una hoja y los resúmenes que la
 * pantalla de reportes muestra —por período, por categoría, por miembro— en
 * las otras, ya calculados sobre exactamente las filas exportadas.
 *
 * ── Decisiones ──────────────────────────────────────────────────────────────
 *
 * · **Los importes son números, no texto.** Es la razón de exportar a Excel:
 *   sumar, filtrar, armar una tabla dinámica. Van con signo (gasto negativo,
 *   ingreso positivo, transferencia según su sentido) y con formato numérico
 *   del exponente de su moneda. La conversión entero → número pasa por el
 *   string decimal, nunca por una división en coma flotante.
 * · **Los resúmenes se calculan acá, sobre las filas**, y no llamando a los
 *   servicios de reportes: así cuadran con lo que hay en la primera hoja aun
 *   cuando se exporta una sola cuenta. La regla es la misma que en los
 *   reportes: todo en la moneda primaria con la conversión congelada, y las
 *   transferencias fuera de ingresos y gastos.
 * · **Las fechas son fechas de Excel**, para poder filtrar por mes. Se arman
 *   al mediodía local: Excel no tiene zona horaria y así el día no se corre
 *   sea cual sea la del servidor.
 */

const TYPE_LABELS: Readonly<Record<string, string>> = {
  INCOME: "Ingreso",
  EXPENSE: "Gasto",
  TRANSFER: "Transferencia",
};

const STATUS_LABELS: Readonly<Record<string, string>> = {
  CLEARED: "Confirmado",
  PENDING: "Pendiente",
};

const DIRECTION_LABELS: Readonly<Record<string, string>> = {
  OUT: "Salida",
  IN: "Entrada",
};

const UNIT_LABELS: Readonly<Record<SeriesGranularity, string>> = {
  day: "Por día",
  week: "Por semana",
  month: "Por mes",
};

const UNCATEGORIZED = "Sin categoría";

/** Una fila de movimiento ya leída, con lo justo para el libro. */
export interface ExportRow {
  readonly id: string;
  readonly type: "INCOME" | "EXPENSE" | "TRANSFER";
  readonly status: string;
  readonly amountMinor: bigint;
  readonly currency: string;
  /** Solo cuando la moneda difiere de la primaria. */
  readonly amountPrimaryMinor: bigint | null;
  readonly date: CalendarDate;
  readonly description: string | null;
  readonly payee: string | null;
  readonly notes: string | null;
  readonly createdByName: string;
  readonly transferGroupId: string | null;
  readonly transferDirection: "OUT" | "IN" | null;
  readonly account: string;
  /** La categoría raíz: la propia, o el padre si es una subcategoría. */
  readonly category: string | null;
  readonly subcategory: string | null;
  readonly tags: readonly string[];
}

export interface WorkbookInput {
  readonly rows: readonly ExportRow[];
  readonly spaceName: string;
  readonly primaryCurrency: string;
  readonly locale: string;
  readonly weekStartsOn: number;
  readonly today: CalendarDate;
  /** El rango pedido. Sin él, el que cubren las filas. */
  readonly range: DateRange | null;
  /** Nombre de la cuenta si se exportó una sola. */
  readonly accountName: string | null;
}

export interface WorkbookResult {
  readonly buffer: Buffer;
  readonly rowCount: number;
  readonly filename: string;
}

// ─────────────────────────────── celdas ──────────────────────────────────────

const HEADER = {
  fontWeight: "bold",
  backgroundColor: "#E7E6E6",
} as const;

const header = (labels: readonly string[]): Row =>
  labels.map((value) => ({ value, type: String, ...HEADER }));

const text = (value: string | null): Row[number] =>
  value === null || value === "" ? null : { value, type: String };

/** Formato numérico con los decimales de la moneda: "#,##0.00" para EUR. */
const numberFormat = (currency: string): string => {
  const exponent = getCurrencyExponent(currency);
  return exponent === 0 ? "#,##0" : `#,##0.${"0".repeat(exponent)}`;
};

/**
 * Entero en unidades mínimas → número de Excel. Pasa por el string decimal,
 * así "1050" en EUR da exactamente 10.5 y no 10.499999.
 */
const amountCell = (amountMinor: bigint, currency: string): Row[number] => ({
  value: Number(toDecimalString(money(amountMinor, currency))),
  type: Number,
  format: numberFormat(currency),
});

/**
 * Fecha calendario como fecha de Excel. Al mediodía local y no a medianoche:
 * la librería serializa el instante y Excel no tiene zona horaria, así que
 * medianoche en un servidor al oeste de Greenwich caería en el día anterior.
 */
const dateCell = (value: CalendarDate): Row[number] => {
  const [year = 0, month = 1, day = 1] = value.split("-").map(Number);
  return {
    value: new Date(year, month - 1, day, 12),
    type: Date,
    format: "dd/mm/yyyy",
  };
};

const percentCell = (part: bigint, total: bigint): Row[number] => ({
  value: total === 0n ? 0 : Number(part) / Number(total),
  type: Number,
  format: "0.0%",
});

// ────────────────────────────── agregados ────────────────────────────────────

/** Lo que vale una fila en la moneda primaria, con la conversión congelada. */
const primaryMinor = (row: ExportRow): bigint =>
  row.amountPrimaryMinor ?? row.amountMinor;

/** Con signo respecto del saldo: gasto y salida restan. */
const signed = (row: ExportRow, amountMinor: bigint): bigint =>
  row.type === "EXPENSE" || row.transferDirection === "OUT"
    ? -amountMinor
    : amountMinor;

interface Totals {
  income: bigint;
  expense: bigint;
  count: number;
}

const emptyTotals = (): Totals => ({ income: 0n, expense: 0n, count: 0 });

/** Ingresos y gastos, nada más: una transferencia no es ninguna de las dos. */
const accumulate = (totals: Totals, row: ExportRow): void => {
  if (row.type === "INCOME") totals.income += primaryMinor(row);
  else if (row.type === "EXPENSE") totals.expense += primaryMinor(row);
  else return;
  totals.count += 1;
};

const totalsRow = (
  label: Row[number],
  totals: Totals,
  currency: string,
): Row => [
  label,
  amountCell(totals.income, currency),
  amountCell(totals.expense, currency),
  amountCell(totals.income - totals.expense, currency),
  { value: totals.count, type: Number },
];

const rowsRange = (rows: readonly ExportRow[]): DateRange | null => {
  const first = rows[0];
  const last = rows.at(-1);
  if (first === undefined || last === undefined) return null;
  // Vienen ordenadas por fecha ascendente.
  return { start: first.date, end: last.date };
};

// ──────────────────────────────── hojas ──────────────────────────────────────

const movementsSheet = (input: WorkbookInput): Sheet<Buffer> => {
  const primary = input.primaryCurrency;

  const data: Row[] = [
    header([
      "Fecha",
      "Tipo",
      "Importe",
      "Moneda",
      `Importe en ${primary}`,
      "Cuenta",
      "Categoría",
      "Subcategoría",
      "Descripción",
      "Beneficiario",
      "Etiquetas",
      "Estado",
      "Autor",
      "Transferencia",
      "Grupo transferencia",
      "Notas",
      "ID",
    ]),
    ...input.rows.map((row): Row => [
      dateCell(row.date),
      text(TYPE_LABELS[row.type] ?? row.type),
      amountCell(signed(row, row.amountMinor), row.currency),
      text(row.currency),
      amountCell(signed(row, primaryMinor(row)), primary),
      text(row.account),
      text(row.category),
      text(row.subcategory),
      text(row.description),
      text(row.payee),
      text(row.tags.join(", ")),
      text(STATUS_LABELS[row.status] ?? row.status),
      text(row.createdByName),
      text(
        row.transferDirection === null
          ? null
          : (DIRECTION_LABELS[row.transferDirection] ?? row.transferDirection),
      ),
      text(row.transferGroupId),
      text(row.notes),
      text(row.id),
    ]),
  ];

  return {
    sheet: "Movimientos",
    data,
    stickyRowsCount: 1,
    columns: [
      12, 14, 14, 8, 16, 18, 18, 18, 32, 18, 18, 12, 14, 13, 38, 32, 28,
    ].map((width) => ({ width })),
  };
};

const summarySheet = (
  input: WorkbookInput,
  range: DateRange,
): Sheet<Buffer> => {
  const primary = input.primaryCurrency;
  const granularity = granularityFor(range);

  const total = emptyTotals();
  const byBucket = new Map<string, Totals>();
  for (const row of input.rows) {
    accumulate(total, row);
    const key = bucketKeyFor(row.date, range, granularity, input.weekStartsOn);
    const bucket = byBucket.get(key) ?? emptyTotals();
    accumulate(bucket, row);
    byBucket.set(key, bucket);
  }

  const data: Row[] = [
    [{ value: "Espacio", ...HEADER }, text(input.spaceName)],
    [{ value: "Período", ...HEADER }, text(describeRange(range, input.locale))],
    [{ value: "Cuenta", ...HEADER }, text(input.accountName ?? "Todas")],
    [
      { value: "Moneda", ...HEADER },
      text(`${primary} (conversión congelada al cargar cada movimiento)`),
    ],
    [{ value: "Generado", ...HEADER }, dateCell(input.today)],
    [],
    header(["", "Ingresos", "Gastos", "Resultado", "Movimientos"]),
    totalsRow(
      { value: "Total", type: String, fontWeight: "bold" },
      total,
      primary,
    ),
    [],
    header([
      UNIT_LABELS[granularity],
      "Ingresos",
      "Gastos",
      "Resultado",
      "Movimientos",
    ]),
    ...bucketsFor(range, granularity, input.weekStartsOn).map((bucket) =>
      totalsRow(
        text(bucketTitle(bucket, granularity, input.locale)),
        byBucket.get(bucket.key) ?? emptyTotals(),
        primary,
      ),
    ),
  ];

  return {
    sheet: "Resumen",
    data,
    columns: [26, 16, 16, 16, 13].map((width) => ({ width })),
  };
};

const categoriesSheet = (input: WorkbookInput): Sheet<Buffer> => {
  const primary = input.primaryCurrency;

  const data: Row[] = [
    header([
      "Tipo",
      "Categoría",
      "Subcategoría",
      `Total (${primary})`,
      "% del tipo",
      "Movimientos",
    ]),
  ];

  for (const kind of ["EXPENSE", "INCOME"] as const) {
    const rows = input.rows.filter((row) => row.type === kind);
    const kindTotal = rows.reduce((sum, row) => sum + primaryMinor(row), 0n);

    interface ChildTotals {
      total: bigint;
      count: number;
    }
    interface Node extends ChildTotals {
      children: Map<string, ChildTotals>;
    }
    const parents = new Map<string, Node>();

    for (const row of rows) {
      const name = row.category ?? UNCATEGORIZED;
      const node: Node = parents.get(name) ?? {
        total: 0n,
        count: 0,
        children: new Map<string, ChildTotals>(),
      };
      node.total += primaryMinor(row);
      node.count += 1;
      if (row.subcategory !== null) {
        const child = node.children.get(row.subcategory) ?? {
          total: 0n,
          count: 0,
        };
        child.total += primaryMinor(row);
        child.count += 1;
        node.children.set(row.subcategory, child);
      }
      parents.set(name, node);
    }

    const byTotal = <T extends { total: bigint }>(
      a: [string, T],
      b: [string, T],
    ) => (b[1].total > a[1].total ? 1 : b[1].total < a[1].total ? -1 : 0);

    for (const [name, node] of [...parents.entries()].sort(byTotal)) {
      data.push([
        text(TYPE_LABELS[kind] ?? kind),
        { value: name, type: String, fontWeight: "bold" },
        null,
        amountCell(node.total, primary),
        percentCell(node.total, kindTotal),
        { value: node.count, type: Number },
      ]);
      for (const [child, totals] of [...node.children.entries()].sort(
        byTotal,
      )) {
        data.push([
          text(TYPE_LABELS[kind] ?? kind),
          text(name),
          text(child),
          amountCell(totals.total, primary),
          percentCell(totals.total, kindTotal),
          { value: totals.count, type: Number },
        ]);
      }
    }
  }

  return {
    sheet: "Por categoría",
    data,
    stickyRowsCount: 1,
    columns: [14, 24, 24, 16, 11, 13].map((width) => ({ width })),
  };
};

const membersSheet = (input: WorkbookInput): Sheet<Buffer> | null => {
  const byMember = new Map<string, Totals>();
  for (const row of input.rows) {
    const totals = byMember.get(row.createdByName) ?? emptyTotals();
    accumulate(totals, row);
    byMember.set(row.createdByName, totals);
  }

  // Con una sola persona la hoja diría lo mismo que el total.
  if (byMember.size < 2) return null;

  const data: Row[] = [
    header(["Miembro", "Ingresos", "Gastos", "Resultado", "Movimientos"]),
    ...[...byMember.entries()]
      .sort((a, b) => (b[1].expense > a[1].expense ? 1 : -1))
      .map(([name, totals]) =>
        totalsRow(text(name), totals, input.primaryCurrency),
      ),
  ];

  return {
    sheet: "Por miembro",
    data,
    columns: [24, 16, 16, 16, 13].map((width) => ({ width })),
  };
};

/**
 * Las hojas del libro, listas para escribir. Es pura: lo que se testea sin
 * base es exactamente lo que se exporta.
 */
export const buildWorkbook = (input: WorkbookInput): Sheet<Buffer>[] => {
  const range = input.range ?? rowsRange(input.rows) ?? monthRange(input.today);

  const sheets: Sheet<Buffer>[] = [
    movementsSheet(input),
    summarySheet(input, range),
    categoriesSheet(input),
  ];
  const members = membersSheet(input);
  if (members !== null) sheets.push(members);

  return sheets;
};

// ─────────────────────────────── lectura ─────────────────────────────────────

const slug = (value: string): string =>
  value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

const buildFilename = (
  spaceName: string,
  accountName: string | null,
  range: DateRange | null,
): string => {
  const parts = ["monkey", slug(spaceName) || "space"];
  if (accountName !== null) parts.push(slug(accountName));
  parts.push(range === null ? "todo" : `${range.start}_${range.end}`);
  return `${parts.join("-")}.xlsx`;
};

export const exportWorkbook = async (
  db: ScopedDb,
  options: {
    readonly space: {
      readonly spaceId: string;
      readonly name: string;
      readonly primaryCurrency: string;
    };
    readonly locale: string;
    readonly timezone: string;
    readonly weekStartsOn: number;
    readonly query: ExportQuery;
  },
): Promise<WorkbookResult> => {
  const { query } = options;
  const range =
    query.from !== undefined && query.to !== undefined
      ? { start: query.from, end: query.to }
      : null;

  const [rows, account] = await Promise.all([
    db.transaction.findMany({
      where: {
        ...(query.from !== undefined || query.to !== undefined
          ? {
              date: {
                ...(query.from !== undefined
                  ? { gte: fromCalendarDate(query.from) }
                  : {}),
                ...(query.to !== undefined
                  ? { lte: fromCalendarDate(query.to) }
                  : {}),
              },
            }
          : {}),
        ...(query.accountId !== undefined
          ? { accountId: query.accountId }
          : {}),
      },
      // Ascendente: un extracto se lee del más viejo al más nuevo.
      orderBy: [{ date: "asc" }, { id: "asc" }],
      select: {
        id: true,
        type: true,
        status: true,
        amountMinor: true,
        currency: true,
        amountPrimaryMinor: true,
        date: true,
        description: true,
        payee: true,
        notes: true,
        createdByName: true,
        transferGroupId: true,
        transferDirection: true,
        account: { select: { name: true } },
        category: {
          select: { name: true, parent: { select: { name: true } } },
        },
        tags: { select: { tag: { select: { name: true } } } },
      },
    }),
    query.accountId === undefined
      ? Promise.resolve(null)
      : db.account.findFirst({
          where: { id: query.accountId },
          select: { name: true },
        }),
  ]);

  const input: WorkbookInput = {
    rows: rows.map((row): ExportRow => {
      const parent = row.category?.parent ?? null;
      return {
        id: row.id,
        type: row.type,
        status: row.status,
        amountMinor: row.amountMinor,
        currency: row.currency,
        amountPrimaryMinor: row.amountPrimaryMinor,
        date: toCalendarDate(row.date),
        description: row.description,
        payee: row.payee,
        notes: row.notes,
        createdByName: row.createdByName,
        transferGroupId: row.transferGroupId,
        transferDirection: row.transferDirection,
        account: row.account.name,
        category:
          row.category === null
            ? null
            : parent === null
              ? row.category.name
              : parent.name,
        subcategory:
          row.category !== null && parent !== null ? row.category.name : null,
        tags: row.tags.map((t) => t.tag.name),
      };
    }),
    spaceName: options.space.name,
    primaryCurrency: options.space.primaryCurrency,
    locale: options.locale,
    weekStartsOn: options.weekStartsOn,
    today: todayIn(options.timezone),
    range,
    accountName: account?.name ?? null,
  };

  const buffer = await writeXlsxFile(buildWorkbook(input), {
    fontFamily: "Calibri",
    fontSize: 11,
  }).toBuffer();

  return {
    buffer,
    rowCount: rows.length,
    filename: buildFilename(options.space.name, input.accountName, range),
  };
};
