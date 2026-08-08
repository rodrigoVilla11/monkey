import { errors } from "@/server/api/errors";
import type { ScopedDb } from "@/server/db/scoped";
import type { TransactionClient } from "@/server/services/audit/log";
import { createTransfer } from "@/server/services/transfers";
import type {
  ImportReport,
  ImportRequest,
  ImportRowResult,
  RowStatus,
} from "@/shared/contracts/import-export";
import { IMPORT_ALIASES } from "@/shared/contracts/import-export";
import { detectDelimiter, mapHeaders, parseCsv } from "@/shared/csv";
import {
  fromCalendarDate,
  isCalendarDate,
  type CalendarDate,
} from "@/shared/dates";
import { parseAmount } from "@/shared/money";

/**
 * Importación de movimientos desde CSV.
 *
 * ── El mismo camino de código para previsualizar y para importar ────────────
 *
 * `dryRun` no salta a otra función: recorre TODO —parseo, validación, detección
 * de duplicados, resolución de categorías— y al final no escribe. Es lo que
 * garantiza que la previsualización no pueda mentir: si dijo que iban a entrar
 * 47 filas, entran 47.
 *
 * ── Qué es un error y qué es un aviso ───────────────────────────────────────
 *
 * La regla: **la plata que se movió tiene que entrar**. Una categoría que no
 * existe es una etiqueta que falta, no una razón para descartar un gasto — la
 * fila entra sin categoría y se avisa. Una fecha ilegible o un importe que no se
 * puede parsear sí son errores: sin ellos no hay movimiento que crear.
 *
 * ── Transferencias ──────────────────────────────────────────────────────────
 *
 * Se reconstruyen por pares usando `grupo_transferencia`. Una pata suelta es un
 * error, no un movimiento a medias: el módulo de transferencias existe
 * precisamente para que eso no pueda pasar, y la importación no es la excepción.
 */

/** Tope de filas por archivo. Es un límite de memoria, no de producto. */
const MAX_ROWS = 5000;

interface SpaceContext {
  readonly spaceId: string;
  readonly primaryCurrency: string;
  readonly timezone: string;
}

interface Actor {
  readonly userId: string;
  readonly name: string;
}

/** Una fila ya entendida, antes de decidir si entra. */
interface ParsedRow {
  readonly line: number;
  readonly externalId: string | null;
  readonly date: CalendarDate;
  readonly amountMinor: bigint;
  /** Deducido del signo si no viene columna de tipo. */
  readonly type: "INCOME" | "EXPENSE" | "TRANSFER";
  readonly currency: string;
  readonly accountName: string | null;
  readonly categoryPath: string | null;
  readonly description: string | null;
  readonly payee: string | null;
  readonly notes: string | null;
  readonly status: "CLEARED" | "PENDING";
  readonly transferGroup: string | null;
  readonly transferDirection: "OUT" | "IN" | null;
  readonly raw: readonly string[];
}

export const importTransactions = async (
  db: ScopedDb,
  tx: TransactionClient,
  space: SpaceContext,
  actor: Actor,
  input: ImportRequest,
): Promise<ImportReport> => {
  const delimiter = detectDelimiter(input.content);
  const rows = parseCsv(input.content, delimiter);

  if (rows.length === 0) {
    throw errors.conflict("UNPROCESSABLE", "El archivo no tiene ninguna fila");
  }
  if (rows.length - 1 > MAX_ROWS) {
    throw errors.conflict(
      "UNPROCESSABLE",
      `El archivo tiene más de ${String(MAX_ROWS)} filas. Partilo en varios`,
    );
  }

  const header = rows[0] ?? [];
  const columns = mapHeaders(header, IMPORT_ALIASES);

  if (columns.date === -1 || columns.amount === -1) {
    throw errors.conflict(
      "UNPROCESSABLE",
      "El archivo necesita al menos una columna de fecha y una de importe",
    );
  }

  const context = await loadContext(db, space, input.defaultAccountId);
  const issues: ImportRowResult[] = [];
  const parsed: ParsedRow[] = [];

  // ── 1. Entender cada fila ────────────────────────────────────────────────
  for (let i = 1; i < rows.length; i += 1) {
    const raw = rows[i] ?? [];
    const line = i + 1;

    const result = parseRow(raw, line, columns, space);

    if ("error" in result) {
      issues.push(fail(line, result.error, raw, columns));
      continue;
    }

    parsed.push(result.row);
  }

  // ── 2. Decidir qué entra ─────────────────────────────────────────────────
  const plan = await buildPlan(db, space, context, parsed, input, issues);

  // ── 3. Escribir, salvo que sea una previsualización ──────────────────────
  let created = 0;

  if (!input.dryRun) {
    created = await applyPlan(db, tx, space, actor, plan);
  } else {
    created = plan.singles.length + plan.transfers.length * 2;
  }

  const failed = issues.filter((issue) => issue.status === "error").length;
  const skipped = issues.filter((issue) => issue.status === "duplicate").length;

  return {
    dryRun: input.dryRun,
    delimiter: delimiter === "\t" ? "tab" : delimiter,
    totalRows: rows.length - 1,
    created,
    skipped,
    failed,
    newCategories: [...plan.newCategories],
    issues,
    clean: parsed.length - issues.filter((i) => i.status === "warning").length,
  };
};

// ────────────────────────────── contexto ─────────────────────────────────────

interface Context {
  /** Cuentas del Space, indexadas por nombre normalizado. */
  readonly accountsByName: Map<string, { id: string; currency: string }>;
  readonly defaultAccount: { id: string; currency: string } | null;
  /** Categorías por ruta normalizada ("alimentacion>supermercado"). */
  readonly categoriesByPath: Map<string, { id: string; kind: string }>;
}

const normalize = (value: string): string =>
  value.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();

const loadContext = async (
  db: ScopedDb,
  space: SpaceContext,
  defaultAccountId: string | undefined,
): Promise<Context> => {
  const [accounts, categories] = await Promise.all([
    db.account.findMany({
      where: { isArchived: false },
      select: { id: true, name: true, currency: true },
    }),
    db.category.findMany({
      select: {
        id: true,
        name: true,
        kind: true,
        parent: { select: { name: true } },
      },
    }),
  ]);

  const accountsByName = new Map(
    accounts.map((account) => [
      normalize(account.name),
      { id: account.id, currency: account.currency },
    ]),
  );

  let defaultAccount: { id: string; currency: string } | null = null;
  if (defaultAccountId !== undefined) {
    const found = accounts.find((account) => account.id === defaultAccountId);
    if (found === undefined) {
      throw errors.notFound("No se encontró la cuenta indicada por defecto");
    }
    defaultAccount = { id: found.id, currency: found.currency };
  }

  const categoriesByPath = new Map<string, { id: string; kind: string }>();
  for (const category of categories) {
    const path =
      category.parent === null
        ? normalize(category.name)
        : `${normalize(category.parent.name)}>${normalize(category.name)}`;

    categoriesByPath.set(path, { id: category.id, kind: category.kind });
    // También por el nombre a secas: un CSV ajeno no trae la ruta completa.
    if (!categoriesByPath.has(normalize(category.name))) {
      categoriesByPath.set(normalize(category.name), {
        id: category.id,
        kind: category.kind,
      });
    }
  }

  return { accountsByName, defaultAccount, categoriesByPath };
};

// ─────────────────────────────── parseo ──────────────────────────────────────

const cell = (raw: readonly string[], index: number): string | null => {
  if (index < 0) return null;
  const value = raw[index]?.trim() ?? "";
  return value === "" ? null : value;
};

const TYPE_ALIASES: Readonly<
  Record<string, "INCOME" | "EXPENSE" | "TRANSFER">
> = {
  ingreso: "INCOME",
  income: "INCOME",
  gasto: "EXPENSE",
  egreso: "EXPENSE",
  expense: "EXPENSE",
  transferencia: "TRANSFER",
  transfer: "TRANSFER",
};

const parseRow = (
  raw: readonly string[],
  line: number,
  columns: Record<string, number>,
  space: SpaceContext,
): { row: ParsedRow } | { error: string } => {
  const rawDate = cell(raw, columns.date ?? -1);
  if (rawDate === null) return { error: "Falta la fecha" };

  const date = parseDate(rawDate);
  if (date === null) {
    return { error: `No se entiende la fecha "${rawDate}"` };
  }

  const rawAmount = cell(raw, columns.amount ?? -1);
  if (rawAmount === null) return { error: "Falta el importe" };

  const currency = cell(raw, columns.currency ?? -1) ?? space.primaryCurrency;

  const parsedAmount = parseAmount(rawAmount, currency);
  if (!parsedAmount.ok) {
    return { error: `No se entiende el importe "${rawAmount}"` };
  }

  const signed = parsedAmount.value.amountMinor;
  if (signed === 0n) return { error: "El importe es cero" };

  const rawType = cell(raw, columns.type ?? -1);
  /**
   * Si no viene tipo, se deduce del SIGNO. Es lo que hace todo banco: el
   * extracto trae importes con signo y ninguna columna de tipo.
   */
  const type =
    rawType === null
      ? signed < 0n
        ? ("EXPENSE" as const)
        : ("INCOME" as const)
      : TYPE_ALIASES[normalize(rawType)];

  if (type === undefined) {
    return { error: `No se entiende el tipo "${rawType ?? ""}"` };
  }

  const rawDirection = cell(raw, columns.transferDirection ?? -1);
  const transferDirection =
    rawDirection === null
      ? null
      : normalize(rawDirection).startsWith("sal") ||
          normalize(rawDirection) === "out"
        ? ("OUT" as const)
        : ("IN" as const);

  const rawStatus = cell(raw, columns.status ?? -1);

  return {
    row: {
      line,
      externalId: cell(raw, columns.id ?? -1),
      date,
      // El importe se guarda SIEMPRE positivo: el signo lo lleva el tipo.
      amountMinor: signed < 0n ? -signed : signed,
      type,
      currency,
      accountName: cell(raw, columns.account ?? -1),
      categoryPath: cell(raw, columns.category ?? -1),
      description: cell(raw, columns.description ?? -1),
      payee: cell(raw, columns.payee ?? -1),
      notes: cell(raw, columns.notes ?? -1),
      status:
        rawStatus !== null && normalize(rawStatus).startsWith("pend")
          ? "PENDING"
          : "CLEARED",
      transferGroup: cell(raw, columns.transferGroup ?? -1),
      transferDirection,
      raw,
    },
  };
};

/**
 * Fechas en los formatos que aparecen de verdad.
 *
 * ISO primero porque es lo que exporta Monkey. Después dd/mm/aaaa, que es lo
 * que usan los bancos españoles y argentinos. **No se intenta mm/dd/aaaa**: es
 * indistinguible de dd/mm hasta el día 13 y equivocarse mueve un gasto tres
 * meses en silencio. Quien tenga un archivo americano lo convierte antes.
 */
const parseDate = (value: string): CalendarDate | null => {
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (iso !== null) {
    const candidate = `${iso[1] ?? ""}-${iso[2] ?? ""}-${iso[3] ?? ""}`;
    return isCalendarDate(candidate) ? candidate : null;
  }

  const dmy = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(value);
  if (dmy !== null) {
    const day = (dmy[1] ?? "").padStart(2, "0");
    const month = (dmy[2] ?? "").padStart(2, "0");
    const rawYear = dmy[3] ?? "";
    const year = rawYear.length === 2 ? `20${rawYear}` : rawYear;
    const candidate = `${year}-${month}-${day}`;
    return isCalendarDate(candidate) ? candidate : null;
  }

  return null;
};

// ──────────────────────────────── plan ───────────────────────────────────────

interface SinglePlan {
  readonly row: ParsedRow;
  readonly accountId: string;
  readonly categoryId: string | null;
  /** Ruta de la categoría a crear, si hay que crearla. */
  readonly createCategory: string | null;
}

interface TransferPlan {
  readonly out: ParsedRow;
  readonly in: ParsedRow;
  readonly fromAccountId: string;
  readonly toAccountId: string;
}

interface Plan {
  readonly singles: SinglePlan[];
  readonly transfers: TransferPlan[];
  readonly newCategories: Set<string>;
}

const buildPlan = async (
  db: ScopedDb,
  space: SpaceContext,
  context: Context,
  parsed: readonly ParsedRow[],
  input: ImportRequest,
  issues: ImportRowResult[],
): Promise<Plan> => {
  const plan: Plan = { singles: [], transfers: [], newCategories: new Set() };

  const existingIds = await findExistingIds(db, parsed);
  const groups = new Map<string, ParsedRow[]>();

  for (const row of parsed) {
    // ── Transferencias: se juntan por grupo y se resuelven al final ────────
    if (row.type === "TRANSFER") {
      if (row.transferGroup === null) {
        issues.push(
          note(
            row,
            "error",
            "Una transferencia necesita su columna de grupo para poder rearmar el par",
          ),
        );
        continue;
      }
      const bucket = groups.get(row.transferGroup) ?? [];
      bucket.push(row);
      groups.set(row.transferGroup, bucket);
      continue;
    }

    // ── Duplicados ────────────────────────────────────────────────────────
    if (row.externalId !== null && existingIds.has(row.externalId)) {
      if (input.onDuplicate !== "import") {
        issues.push(
          note(row, "duplicate", "Ya está importado en este espacio"),
        );
        continue;
      }
    } else if (input.onDuplicate !== "import") {
      const duplicate = await looksDuplicated(db, row, context);
      if (duplicate) {
        issues.push(
          note(row, "duplicate", "Ya hay un movimiento igual en esa fecha"),
        );
        continue;
      }
    }

    // ── Cuenta ────────────────────────────────────────────────────────────
    const account = resolveAccount(row, context);
    if (account === null) {
      issues.push(
        note(
          row,
          "error",
          row.accountName === null
            ? "La fila no trae cuenta y no se indicó una por defecto"
            : `No existe la cuenta "${row.accountName}"`,
        ),
      );
      continue;
    }

    // ── Categoría ─────────────────────────────────────────────────────────
    let categoryId: string | null = null;
    let createCategory: string | null = null;

    if (row.categoryPath !== null) {
      const found = context.categoriesByPath.get(normalize(row.categoryPath));

      if (found !== undefined) {
        if (found.kind !== row.type) {
          // Meter un gasto en una categoría de ingresos rompería los reportes.
          issues.push(
            note(
              row,
              "warning",
              `"${row.categoryPath}" es una categoría de ${found.kind === "INCOME" ? "ingresos" : "gastos"}: la fila entra sin categoría`,
            ),
          );
        } else {
          categoryId = found.id;
        }
      } else if (input.createMissingCategories === true) {
        createCategory = row.categoryPath;
        plan.newCategories.add(row.categoryPath);
      } else {
        // La plata que se movió tiene que entrar: la etiqueta puede faltar.
        issues.push(
          note(
            row,
            "warning",
            `No existe la categoría "${row.categoryPath}": la fila entra sin categoría`,
          ),
        );
      }
    }

    plan.singles.push({
      row,
      accountId: account.id,
      categoryId,
      createCategory,
    });
  }

  // ── Transferencias: cada grupo tiene que tener sus dos patas ────────────
  for (const [group, legs] of groups) {
    const out = legs.find((leg) => leg.transferDirection === "OUT");
    const incoming = legs.find((leg) => leg.transferDirection === "IN");

    if (out === undefined || incoming === undefined) {
      for (const leg of legs) {
        issues.push(
          note(
            leg,
            "error",
            `Falta la otra pata de la transferencia "${group}": una pata suelta descuadraría los saldos`,
          ),
        );
      }
      continue;
    }

    if (
      out.externalId !== null &&
      existingIds.has(out.externalId) &&
      input.onDuplicate !== "import"
    ) {
      issues.push(note(out, "duplicate", "Ya está importada en este espacio"));
      continue;
    }

    const from = resolveAccount(out, context);
    const to = resolveAccount(incoming, context);

    if (from === null || to === null) {
      issues.push(
        note(
          out,
          "error",
          "Alguna de las dos cuentas de la transferencia no existe",
        ),
      );
      continue;
    }

    plan.transfers.push({
      out,
      in: incoming,
      fromAccountId: from.id,
      toAccountId: to.id,
    });
  }

  return plan;
};

const resolveAccount = (
  row: ParsedRow,
  context: Context,
): { id: string; currency: string } | null => {
  if (row.accountName === null) return context.defaultAccount;
  return context.accountsByName.get(normalize(row.accountName)) ?? null;
};

/** IDs del archivo que ya existen en ESTE Space. Uno de otra instalación no
 * coincide con nada y cae en la detección normal de duplicados. */
const findExistingIds = async (
  db: ScopedDb,
  parsed: readonly ParsedRow[],
): Promise<Set<string>> => {
  const ids = parsed
    .map((row) => row.externalId)
    .filter((id): id is string => id !== null);

  if (ids.length === 0) return new Set();

  const found = await db.transaction.findMany({
    where: { id: { in: [...new Set(ids)] } },
    select: { id: true },
  });

  return new Set(found.map((row) => row.id));
};

/**
 * Heurística de duplicado para archivos sin ID: mismo día, misma cuenta, mismo
 * importe y mismo tipo.
 *
 * No incluye la descripción a propósito: los bancos la cambian entre exports
 * del mismo movimiento, y entonces la heurística no detectaría nada. El riesgo
 * es saltear dos cafés idénticos del mismo día en la misma cuenta; por eso
 * `onDuplicate: "import"` existe y por eso se avisa fila por fila en vez de
 * descartar en silencio.
 */
const looksDuplicated = async (
  db: ScopedDb,
  row: ParsedRow,
  context: Context,
): Promise<boolean> => {
  const account = resolveAccount(row, context);
  if (account === null) return false;

  const found = await db.transaction.findFirst({
    where: {
      date: fromCalendarDate(row.date),
      accountId: account.id,
      amountMinor: row.amountMinor,
      type: row.type,
    },
    select: { id: true },
  });

  return found !== null;
};

// ─────────────────────────────── escritura ───────────────────────────────────

const applyPlan = async (
  db: ScopedDb,
  tx: TransactionClient,
  space: SpaceContext,
  actor: Actor,
  plan: Plan,
): Promise<number> => {
  // Las categorías nuevas se crean primero: varias filas pueden compartirla.
  const createdCategories = new Map<string, string>();

  for (const path of plan.newCategories) {
    const kind =
      plan.singles.find((single) => single.createCategory === path)?.row.type ??
      "EXPENSE";

    const created = await tx.category.create({
      data: {
        spaceId: space.spaceId,
        // Solo el último nivel: crear el árbol entero desde un CSV sería
        // adivinar demasiado.
        name: path.split(">").at(-1)?.trim() ?? path,
        kind: kind === "TRANSFER" ? "EXPENSE" : kind,
      },
      select: { id: true },
    });

    createdCategories.set(normalize(path), created.id);
  }

  let created = 0;

  if (plan.singles.length > 0) {
    await tx.transaction.createMany({
      data: plan.singles.map((single) => ({
        spaceId: space.spaceId,
        accountId: single.accountId,
        categoryId:
          single.categoryId ??
          (single.createCategory === null
            ? null
            : (createdCategories.get(normalize(single.createCategory)) ??
              null)),
        createdByUserId: actor.userId,
        createdByName: actor.name,
        type: single.row.type === "TRANSFER" ? "EXPENSE" : single.row.type,
        status: single.row.status,
        amountMinor: single.row.amountMinor,
        currency: single.row.currency,
        date: fromCalendarDate(single.row.date),
        description: single.row.description,
        payee: single.row.payee,
        notes: single.row.notes,
      })),
      // Si dos peticiones simultáneas importan el mismo archivo, el índice de
      // la base decide y acá no se rompe la corrida.
      skipDuplicates: true,
    });

    created += plan.singles.length;
  }

  /**
   * Las transferencias van por `createTransfer` y no por un insert directo:
   * es la única forma de que sigan valiendo lo mismo en moneda primaria y de
   * que no nazca una pata suelta. Reimplementarlo acá sería duplicar la
   * invariante más delicada del proyecto.
   */
  for (const transfer of plan.transfers) {
    await createTransfer(
      db,
      tx,
      { spaceId: space.spaceId, primaryCurrency: space.primaryCurrency },
      { userId: actor.userId, name: actor.name, timezone: space.timezone },
      {
        fromAccountId: transfer.fromAccountId,
        toAccountId: transfer.toAccountId,
        amountOutMinor: transfer.out.amountMinor.toString(),
        ...(transfer.out.currency !== transfer.in.currency
          ? { amountInMinor: transfer.in.amountMinor.toString() }
          : {}),
        date: transfer.out.date,
        ...(transfer.out.description !== null
          ? { description: transfer.out.description }
          : {}),
      },
    );

    created += 2;
  }

  return created;
};

// ──────────────────────────────── avisos ─────────────────────────────────────

const note = (
  row: ParsedRow,
  status: RowStatus,
  message: string,
): ImportRowResult => ({
  line: row.line,
  status,
  message,
  preview: {
    date: row.date,
    amount: row.amountMinor.toString(),
    description: row.description,
    account: row.accountName,
    category: row.categoryPath,
  },
});

const fail = (
  line: number,
  message: string,
  raw: readonly string[],
  columns: Record<string, number>,
): ImportRowResult => ({
  line,
  status: "error",
  message,
  preview: {
    date: cell(raw, columns.date ?? -1),
    amount: cell(raw, columns.amount ?? -1),
    description: cell(raw, columns.description ?? -1),
    account: cell(raw, columns.account ?? -1),
    category: cell(raw, columns.category ?? -1),
  },
});
