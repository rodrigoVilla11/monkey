import { z } from "zod";

import { calendarDateSchema, cuidSchema } from "./common";

/**
 * Importación y exportación de movimientos en CSV.
 *
 * ── Las dos decisiones de diseño ────────────────────────────────────────────
 *
 * **1. Ni rechazar todo ni importar en silencio: previsualizar.** Un CSV de 500
 * filas del banco no puede fallar entero por una línea rara, pero importar "lo
 * que se pueda" y callar lo que se descartó es peor: son datos financieros que
 * desaparecen sin que nadie se entere. Se manda el mismo archivo dos veces, con
 * `dryRun: true` primero — la previsualización ES la importación con la
 * escritura suprimida, así no pueden divergir nunca.
 *
 * **2. La exportación lleva el ID interno.** Es lo que hace exacto el viaje de
 * ida y vuelta, que es la razón principal por la que alguien exporta. El
 * acoplamiento se acota solo: al importar, ese ID únicamente sirve para detectar
 * "esto ya está en ESTE Space"; uno de otra instalación no coincide con nada y
 * cae en la detección normal de duplicados.
 *
 * Módulo puro: sin Next, sin Prisma, sin React.
 */

export const exportQuerySchema = z.object({
  from: calendarDateSchema.optional(),
  to: calendarDateSchema.optional(),
  accountId: cuidSchema.optional(),
  /**
   * Separador. Por defecto, el que le corresponde al locale de quien pide:
   * donde la coma es decimal, Excel espera `;` y con `,` abre todo en una
   * columna.
   */
  delimiter: z.enum([",", ";", "tab"]).optional(),
});

export type ExportQuery = z.infer<typeof exportQuerySchema>;

export const importRequestSchema = z.object({
  /** El contenido del archivo. Se manda como texto, no como multipart. */
  content: z.string().min(1, "El archivo está vacío").max(5_000_000),
  /**
   * `true` = previsualizar sin escribir nada. Es el mismo camino de código.
   */
  dryRun: z.boolean(),
  /** Cuenta para las filas que no traen columna de cuenta. */
  defaultAccountId: cuidSchema.optional(),
  /**
   * Crear las categorías que no existan. Por defecto NO: una falta de ortografía
   * en el CSV no debería llenar el Space de categorías fantasma. Sin esto, la
   * fila entra sin categoría y se avisa.
   */
  createMissingCategories: z.boolean().optional(),
  /**
   * Qué hacer con lo que ya parece estar cargado. Por defecto se saltea: el
   * daño de importar dos veces el mismo mes es peor que el de saltear una fila
   * que resultó no ser duplicada.
   */
  onDuplicate: z.enum(["skip", "import"]).optional(),
});

export type ImportRequest = z.infer<typeof importRequestSchema>;

// ────────────────────────────── respuestas ───────────────────────────────────

export type RowStatus =
  /** Se va a crear (o se creó). */
  | "ok"
  /** Entra, pero con una salvedad: categoría desconocida, por ejemplo. */
  | "warning"
  /** Ya existe en este Space. */
  | "duplicate"
  /** No entra. */
  | "error";

export interface ImportRowResult {
  /** Número de línea en el archivo, contando la cabecera. Para poder buscarla. */
  readonly line: number;
  readonly status: RowStatus;
  /** Qué pasó, en una frase. Vacío si simplemente entra. */
  readonly message: string | null;
  /** Lo que se entendió de la fila, para que se pueda revisar en pantalla. */
  readonly preview: {
    readonly date: string | null;
    readonly amount: string | null;
    readonly description: string | null;
    readonly account: string | null;
    readonly category: string | null;
  };
}

export interface ImportReport {
  readonly dryRun: boolean;
  readonly delimiter: string;
  readonly totalRows: number;
  readonly created: number;
  readonly skipped: number;
  readonly failed: number;
  /** Categorías que se crearían (o crearon) por no existir. */
  readonly newCategories: readonly string[];
  /**
   * Solo las filas que NO son un simple "ok": errores, avisos y duplicados.
   * Devolver 500 filas correctas no le sirve a nadie y hace la respuesta
   * enorme.
   */
  readonly issues: readonly ImportRowResult[];
  /** Cuántas filas entraron sin ninguna salvedad. */
  readonly clean: number;
}

/** Cabeceras que produce la exportación, en orden. */
export const EXPORT_HEADERS = [
  "id",
  "fecha",
  "tipo",
  "importe",
  "moneda",
  "cuenta",
  "categoria",
  "descripcion",
  "beneficiario",
  "notas",
  "etiquetas",
  "estado",
  "autor",
  "grupo_transferencia",
  "sentido_transferencia",
] as const;

/**
 * Alias aceptados al importar, por columna.
 *
 * La lista es generosa a propósito: la gente exporta desde su banco y no revisa
 * el archivo. Cuantos más nombres se reconozcan, menos gente tiene que editar
 * un CSV a mano antes de poder usar la app.
 */
export const IMPORT_ALIASES: Readonly<Record<string, readonly string[]>> = {
  id: ["id", "identificador"],
  date: ["fecha", "date", "fechaoperacion", "fechavalor", "fecha_operacion"],
  type: ["tipo", "type"],
  amount: ["importe", "amount", "monto", "cantidad", "valor"],
  currency: ["moneda", "currency", "divisa"],
  account: ["cuenta", "account"],
  category: ["categoria", "category", "rubro"],
  description: ["descripcion", "description", "concepto", "detalle"],
  payee: ["beneficiario", "payee", "comercio"],
  notes: ["notas", "notes", "observaciones"],
  tags: ["etiquetas", "tags"],
  status: ["estado", "status"],
  transferGroup: ["grupo_transferencia", "grupotransferencia", "transfergroup"],
  transferDirection: [
    "sentido_transferencia",
    "sentidotransferencia",
    "transferdirection",
  ],
};
