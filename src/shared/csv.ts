/**
 * CSV: parseo y serialización. Lógica pura, sin base de datos ni ficheros.
 *
 * Se implementa a mano en vez de traer una dependencia porque el formato real
 * que hay que soportar no es "CSV", son los tres o cuatro CSV que produce la
 * gente de verdad, y las bibliotecas suelen resolver uno y romperse con el
 * resto:
 *
 *  · **El punto y coma.** Excel en español usa `;` como separador, porque la
 *    coma ya está ocupada haciendo de separador decimal. Un parser que asume
 *    `,` lee un extracto bancario español como una sola columna gigante.
 *  · **El BOM.** Excel escribe `﻿` al principio de los UTF-8. Sin quitarlo,
 *    la primera cabecera se llama `"﻿fecha"` y no coincide con nada.
 *  · **Comillas.** Un campo entrecomillado puede contener el separador, saltos
 *    de línea y comillas duplicadas (`""`). Partir por `split(",")` funciona
 *    hasta la primera descripción con una coma.
 *  · **Finales de línea.** CRLF de Windows, LF de todo lo demás, y CR suelto de
 *    algún export viejo de Mac.
 *
 * Módulo puro: sin Next, sin Prisma, sin React.
 */

export type CsvDelimiter = "," | ";" | "\t";

const BOM = "﻿";

/**
 * Adivina el separador contando cuál aparece más en la primera línea, fuera de
 * comillas.
 *
 * Se mira solo la cabecera porque es la línea donde menos ruido hay: una
 * descripción con punto y coma en la fila 40 no puede confundir la cuenta.
 */
export const detectDelimiter = (input: string): CsvDelimiter => {
  const firstLine = stripBom(input).split(/\r\n|\r|\n/)[0] ?? "";

  let inQuotes = false;
  const counts: Record<CsvDelimiter, number> = { ",": 0, ";": 0, "\t": 0 };

  for (const char of firstLine) {
    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (inQuotes) continue;
    if (char === "," || char === ";" || char === "\t") counts[char] += 1;
  }

  // Empate o cabecera de una sola columna: la coma es el default del formato.
  if (counts[";"] > counts[","] && counts[";"] >= counts["\t"]) return ";";
  if (counts["\t"] > counts[","] && counts["\t"] > counts[";"]) return "\t";
  return ",";
};

export const stripBom = (input: string): string =>
  input.startsWith(BOM) ? input.slice(BOM.length) : input;

/**
 * Parsea a filas de celdas.
 *
 * Es una máquina de estados de un solo recorrido, no una serie de `split`:
 * dentro de comillas, el separador y el salto de línea son texto.
 *
 * Las filas totalmente vacías se descartan —un CSV suele terminar en salto de
 * línea— pero una fila con celdas vacías NO: `,,,` son cuatro columnas vacías y
 * puede ser un dato legítimo.
 */
export const parseCsv = (
  input: string,
  delimiter: CsvDelimiter = detectDelimiter(input),
): string[][] => {
  const text = stripBom(input);
  const rows: string[][] = [];

  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  const endCell = (): void => {
    row.push(cell);
    cell = "";
  };

  const endRow = (): void => {
    endCell();
    // Una fila con una sola celda vacía es el salto final del archivo.
    if (!(row.length === 1 && row[0] === "")) rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i += 1) {
    // El bucle está acotado por el largo, pero `noUncheckedIndexedAccess`
    // tipa el acceso como opcional y tiene razón en principio.
    const char = text[i] ?? "";

    if (inQuotes) {
      if (char === '"') {
        // Comilla duplicada dentro de comillas: es una comilla literal.
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"' && cell === "") {
      inQuotes = true;
      continue;
    }

    if (char === delimiter) {
      endCell();
      continue;
    }

    if (char === "\n") {
      endRow();
      continue;
    }

    if (char === "\r") {
      // CRLF cuenta como un solo final de línea; CR suelto también termina.
      if (text[i + 1] === "\n") i += 1;
      endRow();
      continue;
    }

    cell += char;
  }

  // Lo que quedó sin cerrar es la última fila, si tiene algo.
  if (cell !== "" || row.length > 0) endRow();

  return rows;
};

/**
 * Escapa una celda solo si hace falta.
 *
 * Entrecomillar todo sería más simple y haría los archivos ilegibles a ojo, que
 * es media razón por la que alguien exporta a CSV.
 *
 * El caso del espacio inicial o final importa: sin comillas, algunos lectores
 * lo recortan y "  " deja de ser lo que era.
 */
export const escapeCell = (value: string, delimiter: CsvDelimiter): string => {
  const needsQuotes =
    value.includes(delimiter) ||
    value.includes('"') ||
    value.includes("\n") ||
    value.includes("\r") ||
    value !== value.trim();

  if (!needsQuotes) return value;
  return `"${value.replaceAll('"', '""')}"`;
};

export interface SerializeOptions {
  readonly delimiter?: CsvDelimiter;
  /**
   * Antepone el BOM. Excel abre un UTF-8 sin BOM como Latin-1 y convierte las
   * tildes en jeroglíficos, así que por defecto va puesto.
   */
  readonly bom?: boolean;
  /** CRLF por defecto: es lo que espera Excel y lo que tolera todo lo demás. */
  readonly eol?: "\r\n" | "\n";
}

export const serializeCsv = (
  rows: readonly (readonly string[])[],
  options: SerializeOptions = {},
): string => {
  const delimiter = options.delimiter ?? ",";
  const eol = options.eol ?? "\r\n";

  const body = rows
    .map((row) =>
      row.map((cell) => escapeCell(cell, delimiter)).join(delimiter),
    )
    .join(eol);

  return `${options.bom === false ? "" : BOM}${body}${body === "" ? "" : eol}`;
};

/**
 * El separador que le conviene a un locale.
 *
 * Donde la coma es el separador decimal, Excel espera `;` — y un CSV separado
 * por comas se abre todo en una columna. No es una preferencia estética: es la
 * diferencia entre un archivo que se abre y uno que hay que arreglar a mano.
 */
export const delimiterForLocale = (locale: string): CsvDelimiter => {
  try {
    const decimal = new Intl.NumberFormat(locale)
      .formatToParts(1.1)
      .find((part) => part.type === "decimal")?.value;
    return decimal === "," ? ";" : ",";
  } catch {
    return ",";
  }
};

// ─────────────────────────────── cabeceras ───────────────────────────────────

/**
 * Normaliza una cabecera para poder compararla: sin tildes, sin espacios de
 * más, en minúsculas.
 *
 * Hace que "Fecha", "fecha", "FECHA " y "Fecha " sean la misma columna, que es
 * lo que espera cualquiera que exportó desde su banco y no revisó el archivo.
 */
export const normalizeHeader = (value: string): string =>
  value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");

/**
 * Índice de cada columna conocida, buscando por cualquiera de sus alias.
 *
 * Devuelve `-1` para las que no estén. Quien llama decide cuáles son
 * obligatorias: no es lo mismo que falte la fecha que que falte la etiqueta.
 */
export const mapHeaders = (
  header: readonly string[],
  aliases: Readonly<Record<string, readonly string[]>>,
): Record<string, number> => {
  const normalized = header.map(normalizeHeader);
  const result: Record<string, number> = {};

  for (const [field, names] of Object.entries(aliases)) {
    result[field] = normalized.findIndex((column) =>
      names.some((name) => normalizeHeader(name) === column),
    );
  }

  return result;
};
