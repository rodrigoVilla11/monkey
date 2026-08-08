import type { ScopedDb } from "@/server/db/scoped";
import type { ExportQuery } from "@/shared/contracts/import-export";
import { EXPORT_HEADERS } from "@/shared/contracts/import-export";
import {
  delimiterForLocale,
  serializeCsv,
  type CsvDelimiter,
} from "@/shared/csv";
import { fromCalendarDate, toCalendarDate } from "@/shared/dates";
import { toDecimalString, money } from "@/shared/money";

/**
 * Exportación de movimientos a CSV.
 *
 * ── Los detalles que hacen que el archivo se abra bien ──────────────────────
 *
 * · **El separador sale del locale.** Donde la coma es el separador decimal
 *   —España, Argentina— Excel espera `;`, y con `,` abre el archivo entero en
 *   una sola columna. No es estética: es la diferencia entre un archivo que
 *   funciona y uno que hay que arreglar a mano.
 * · **BOM al principio.** Sin él, Excel lee el UTF-8 como Latin-1 y convierte
 *   "Café" en "CafÃ©".
 * · **El importe va en unidades mayores con el separador decimal del locale**,
 *   porque el archivo es para leerlo y para abrirlo en una hoja de cálculo. La
 *   precisión no se pierde: se formatea desde el entero, nunca desde un float.
 *
 * ── El ID ───────────────────────────────────────────────────────────────────
 *
 * La primera columna es el ID interno. Es lo que permite reimportar el archivo
 * sin duplicar nada, que es la razón principal por la que alguien exporta.
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

export interface ExportResult {
  readonly csv: string;
  readonly rowCount: number;
  readonly filename: string;
}

export const exportTransactions = async (
  db: ScopedDb,
  options: {
    readonly locale: string;
    readonly spaceName: string;
    readonly query: ExportQuery;
  },
): Promise<ExportResult> => {
  const { query } = options;

  const rows = await db.transaction.findMany({
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
      ...(query.accountId !== undefined ? { accountId: query.accountId } : {}),
    },
    // Ascendente: un extracto se lee del más viejo al más nuevo, al revés que
    // la pantalla de movimientos.
    orderBy: [{ date: "asc" }, { id: "asc" }],
    select: {
      id: true,
      type: true,
      status: true,
      amountMinor: true,
      currency: true,
      date: true,
      description: true,
      payee: true,
      notes: true,
      createdByName: true,
      transferGroupId: true,
      transferDirection: true,
      account: { select: { name: true } },
      category: { select: { name: true, parent: { select: { name: true } } } },
      tags: { select: { tag: { select: { name: true } } } },
    },
  });

  const delimiter = resolveDelimiter(query.delimiter, options.locale);

  const body = rows.map((row) => [
    row.id,
    toCalendarDate(row.date),
    TYPE_LABELS[row.type] ?? row.type,
    // Con signo: es lo que espera cualquier hoja de cálculo y lo que produce
    // cualquier banco. Al reimportar, el signo basta para deducir el tipo.
    formatAmount(
      row.type === "EXPENSE" || row.transferDirection === "OUT"
        ? -row.amountMinor
        : row.amountMinor,
      row.currency,
      options.locale,
    ),
    row.currency,
    row.account.name,
    categoryPath(row.category),
    row.description ?? "",
    row.payee ?? "",
    row.notes ?? "",
    row.tags.map((t) => t.tag.name).join(", "),
    STATUS_LABELS[row.status] ?? row.status,
    row.createdByName,
    row.transferGroupId ?? "",
    row.transferDirection === null
      ? ""
      : (DIRECTION_LABELS[row.transferDirection] ?? row.transferDirection),
  ]);

  return {
    csv: serializeCsv([[...EXPORT_HEADERS], ...body], { delimiter }),
    rowCount: body.length,
    filename: buildFilename(options.spaceName, query),
  };
};

const resolveDelimiter = (
  requested: ExportQuery["delimiter"],
  locale: string,
): CsvDelimiter => {
  if (requested === "tab") return "\t";
  if (requested === ";" || requested === ",") return requested;
  return delimiterForLocale(locale);
};

/**
 * Importe en unidades mayores con el separador decimal del locale.
 *
 * Se formatea desde el entero con `toDecimalString` y después se cambia el
 * punto por lo que corresponda: nunca pasa por `Number`, así que no hay
 * pérdida de precisión ni con importes grandes en pesos.
 *
 * Sin separador de miles a propósito: es lo que las hojas de cálculo parsean
 * sin discutir.
 */
const formatAmount = (
  amountMinor: bigint,
  currency: string,
  locale: string,
): string => {
  const plain = toDecimalString(money(amountMinor, currency));
  return delimiterForLocale(locale) === ";" ? plain.replace(".", ",") : plain;
};

/** "Alimentación > Supermercado", para no perder el nivel al exportar. */
const categoryPath = (
  category: { name: string; parent: { name: string } | null } | null,
): string => {
  if (category === null) return "";
  return category.parent === null
    ? category.name
    : `${category.parent.name} > ${category.name}`;
};

const buildFilename = (spaceName: string, query: ExportQuery): string => {
  const slug = spaceName
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  const range =
    query.from !== undefined || query.to !== undefined
      ? `-${query.from ?? "inicio"}_${query.to ?? "hoy"}`
      : "";

  return `monkey-${slug === "" ? "space" : slug}${range}.csv`;
};
