import { Prisma } from "@/generated/prisma/client";

import {
  hasSoftDelete,
  isGlobal,
  isSelfScoped,
  isSpaceScoped,
  isSystemOnly,
} from "./models";

/**
 * Extensión de Prisma que hace imposible olvidarse del `spaceId`.
 *
 * Se eligió una extensión y no un patrón repositorio por una razón concreta:
 * un repositorio PERMITE olvidarse. Si mañana alguien agrega
 * `SavingsGoalRepository` y no le pasa el spaceId al constructor, compila y
 * filtra datos. Acá el default es seguro: toda operación pasa por este hook,
 * y lo que no está clasificado explota en vez de pasar de largo.
 *
 * Qué hace, según el modelo:
 *
 *  · con `spaceId`  → inyecta el filtro en `where` y el valor en `data`
 *  · `Space`        → inyecta `id: spaceId` (su PK es su propio scope)
 *  · `ExchangeRate` → lo deja pasar; es global de verdad
 *  · identidad      → tira. Eso se toca con `systemClient()`
 *
 * Además agrega `deletedAt: null` a las lecturas de los modelos con borrado
 * lógico.
 *
 * ── Lo que esta extensión NO cubre ────────────────────────────────────────
 * Los `include`/`select` anidados no pasan por el hook, así que no llevan
 * filtro. No es un agujero de seguridad porque TODAS las relaciones del
 * dominio usan claves foráneas compuestas (spaceId, id): una fila anidada de
 * otro Space no puede existir. Sí implica que un `include` puede traer filas
 * borradas lógicamente; usá una consulta aparte cuando eso importe.
 *
 * El SQL crudo tampoco pasa por acá. Por eso vive solo en `db/raw/**` y
 * recibe el spaceId como primer parámetro, con un test de arquitectura que lo
 * verifica.
 */

export class SpaceScopeError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "SpaceScopeError";
  }
}

/** Operaciones cuyo `where` es un filtro libre: se puede envolver en AND. */
const FILTER_OPERATIONS = new Set([
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
  "updateMany",
  "deleteMany",
]);

/**
 * Operaciones cuyo `where` es un WhereUniqueInput: Prisma exige un campo único
 * en el nivel superior, así que hay que MEZCLAR en vez de envolver en AND.
 * (Desde Prisma 5 ese input acepta además campos no únicos, que es lo que
 * permite colar el spaceId acá.)
 */
const UNIQUE_WHERE_OPERATIONS = new Set([
  "findUnique",
  "findUniqueOrThrow",
  "update",
  "delete",
]);

const CREATE_OPERATIONS = new Set([
  "create",
  "createMany",
  "createManyAndReturn",
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export interface SpaceScopeOptions {
  /**
   * Incluye las filas con borrado lógico. Solo para pantallas de papelera o
   * tareas de mantenimiento; el default es no verlas.
   */
  readonly includeDeleted?: boolean;
}

export const spaceScope = (
  spaceId: string,
  options: SpaceScopeOptions = {},
) => {
  if (spaceId === "") {
    throw new SpaceScopeError("forSpace() necesita un spaceId no vacío");
  }

  const includeDeleted = options.includeDeleted ?? false;

  /** Predicado que identifica al Space actual, según cómo lo modele la tabla. */
  const scopeFilter = (model: string): Record<string, unknown> =>
    isSelfScoped(model) ? { id: spaceId } : { spaceId };

  const softDeleteFilter = (model: string): Record<string, unknown> =>
    hasSoftDelete(model) && !includeDeleted ? { deletedAt: null } : {};

  return Prisma.defineExtension({
    name: "monkey-space-scope",
    query: {
      $allModels: {
        $allOperations(params) {
          // Prisma tipa este hook de forma genérica y muy amplia. Se estrecha
          // una sola vez, acá, para que el resto del archivo quede tipado.
          const { model, operation, args, query } = params as unknown as {
            model?: string;
            operation: string;
            args: unknown;
            query: (next: unknown) => Promise<unknown>;
          };

          const modelName = model ?? "";

          if (isGlobal(modelName)) {
            return query(args);
          }

          if (isSystemOnly(modelName)) {
            throw new SpaceScopeError(
              `${modelName} no es accesible desde un cliente scopeado por Space. ` +
                `Usá systemClient() si de verdad necesitás cruzar Spaces.`,
            );
          }

          if (!isSpaceScoped(modelName) && !isSelfScoped(modelName)) {
            // Modelo nuevo sin clasificar: se prefiere romper a dejar pasar
            // una consulta sin filtrar.
            throw new SpaceScopeError(
              `El modelo ${modelName} no está clasificado en db/models.ts. ` +
                `Agregalo antes de usarlo.`,
            );
          }

          const scope = scopeFilter(modelName);
          const soft = softDeleteFilter(modelName);
          const next: Record<string, unknown> = isRecord(args)
            ? { ...args }
            : {};

          if (FILTER_OPERATIONS.has(operation)) {
            const guard = { ...scope, ...soft };
            next.where = isRecord(next.where)
              ? { AND: [guard, next.where] }
              : guard;
          } else if (UNIQUE_WHERE_OPERATIONS.has(operation)) {
            // Mezcla en el nivel superior: envolver en AND dejaría el where
            // sin campo único y Prisma lo rechazaría.
            next.where = isRecord(next.where)
              ? { ...next.where, ...scope, ...soft }
              : { ...scope, ...soft };
          } else if (operation === "upsert") {
            next.where = isRecord(next.where)
              ? { ...next.where, ...scope }
              : { ...scope };
            if (isRecord(next.create)) {
              next.create = { ...next.create, ...scopeFilter(modelName) };
            }
          }

          if (CREATE_OPERATIONS.has(operation) && !isSelfScoped(modelName)) {
            const data = next.data;
            if (Array.isArray(data)) {
              // Array.isArray sobre unknown estrecha a any[]; se reafirma a
              // unknown[] para no perder el tipado dentro del map.
              const rows = data as unknown[];
              next.data = rows.map((row) =>
                isRecord(row) ? { ...row, ...scope } : row,
              );
            } else if (isRecord(data)) {
              next.data = { ...data, ...scope };
            }
          }

          // Nadie mueve una fila de Space a través de un update.
          if (operation === "update" || operation === "updateMany") {
            if (isRecord(next.data) && "spaceId" in next.data) {
              throw new SpaceScopeError(
                `No se puede cambiar el spaceId de un ${modelName} existente.`,
              );
            }
          }

          return query(next);
        },
      },
    },
  });
};
