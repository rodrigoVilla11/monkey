import { prisma } from "./client";
import { spaceScope, type SpaceScopeOptions } from "./space-scope";

/**
 * Cliente de base de datos acotado a un Space.
 *
 * Es la única forma en que el código de dominio habla con la base:
 *
 *   const db = forSpace(spaceId);
 *   const transacciones = await db.transaction.findMany({ where: { type: "EXPENSE" } });
 *
 * El `spaceId` NUNCA sale del body ni de la query de un request: viene de
 * `requireSpaceAccess()`, que verifica la membresía antes de devolverlo.
 *
 * `forSpace` se llama por request, no una vez global. El cliente extendido es
 * un wrapper barato sobre el pool de conexiones compartido: no abre conexiones
 * nuevas.
 *
 * ── Sobre las lecturas ────────────────────────────────────────────────────
 * El filtro por Space se inyecta solo. No hace falta (ni sirve) escribir
 * `where: { spaceId }`: la extensión lo agrega igual y con AND, así que un
 * spaceId ajeno escrito a mano da cero filas en vez de datos de otro.
 *
 * ── Sobre las escrituras ──────────────────────────────────────────────────
 * Los tipos generados por Prisma SIGUEN pidiendo `spaceId` en los `create`.
 * Se dejó a propósito así en vez de reescribir los tipos de entrada:
 *
 *   await db.transaction.create({ data: { spaceId, accountId, ... } });
 *
 * Parece redundante, pero las dos capas hacen cosas distintas y complementarias:
 * el tipo obliga a que el autor sepa en qué Space está escribiendo, y la
 * extensión garantiza que el valor sea el correcto — si alguien pasa el
 * spaceId de otro Space (por un bug o por un body malicioso), lo pisa.
 * Además, las claves foráneas compuestas impiden que los IDs relacionados
 * (accountId, categoryId) sean de otro Space.
 */
export type ScopedDb = ReturnType<typeof forSpace>;

export const forSpace = (spaceId: string, options: SpaceScopeOptions = {}) =>
  prisma.$extends(spaceScope(spaceId, options));

/**
 * Igual que `forSpace`, pero incluye las filas con borrado lógico.
 * Para papelera y mantenimiento; no para el camino normal.
 */
export const forSpaceWithDeleted = (spaceId: string) =>
  forSpace(spaceId, { includeDeleted: true });
