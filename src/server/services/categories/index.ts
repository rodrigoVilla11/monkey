import { errors } from "@/server/api/errors";
import type { ScopedDb } from "@/server/db/scoped";
import {
  writeAuditLog,
  type TransactionClient,
} from "@/server/services/audit/log";
import type {
  CategoryDTO,
  CategoryTreeNode,
  CreateCategoryRequest,
  UpdateCategoryRequest,
} from "@/shared/contracts/categories";

/**
 * Categorías, con jerarquía de máximo dos niveles.
 *
 * La regla de los dos niveles no la puede expresar el esquema (una
 * self-relation admite profundidad infinita), así que se hace cumplir acá:
 * una categoría que ya tiene padre no puede ser padre de otra.
 */

const SELECT = {
  id: true,
  name: true,
  kind: true,
  parentId: true,
  icon: true,
  color: true,
  sortOrder: true,
  isSystem: true,
} as const;

const toDTO = (row: {
  id: string;
  name: string;
  kind: string;
  parentId: string | null;
  icon: string | null;
  color: string | null;
  sortOrder: number;
  isSystem: boolean;
}): CategoryDTO => ({
  id: row.id,
  name: row.name,
  kind: row.kind as CategoryDTO["kind"],
  parentId: row.parentId,
  icon: row.icon,
  color: row.color,
  sortOrder: row.sortOrder,
  isSystem: row.isSystem,
});

export const listCategories = async (
  db: ScopedDb,
  kind?: "INCOME" | "EXPENSE",
): Promise<CategoryTreeNode[]> => {
  const rows = await db.category.findMany({
    where: kind !== undefined ? { kind } : {},
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: SELECT,
  });

  // Se arma el árbol en memoria: son decenas de filas, no vale la pena una
  // segunda consulta ni un CTE recursivo para dos niveles.
  const byParent = new Map<string, CategoryDTO[]>();
  for (const row of rows) {
    if (row.parentId === null) continue;
    const siblings = byParent.get(row.parentId) ?? [];
    siblings.push(toDTO(row));
    byParent.set(row.parentId, siblings);
  }

  return rows
    .filter((row) => row.parentId === null)
    .map((row) => ({ ...toDTO(row), children: byParent.get(row.id) ?? [] }));
};

/**
 * Valida que un padre exista, sea del mismo tipo y no tenga padre él mismo.
 *
 * El chequeo de existencia va por el cliente scopeado, así que un `parentId`
 * de otro Space simplemente no aparece — y encima la clave foránea compuesta
 * lo rechazaría en la base.
 */
const validateParent = async (
  db: ScopedDb,
  parentId: string,
  kind: string,
  selfId?: string,
): Promise<void> => {
  if (parentId === selfId) {
    throw errors.conflict(
      "CONFLICT",
      "Una categoría no puede ser su propio padre",
    );
  }

  const parent = await db.category.findFirst({
    where: { id: parentId },
    select: { id: true, kind: true, parentId: true },
  });

  if (parent === null) {
    throw errors.notFound("No se encontró la categoría padre");
  }

  if (parent.kind !== kind) {
    throw errors.conflict(
      "CONFLICT",
      "La categoría padre tiene que ser del mismo tipo (ingreso o gasto)",
    );
  }

  if (parent.parentId !== null) {
    throw errors.conflict(
      "CONFLICT",
      "Solo se admiten dos niveles de categorías",
    );
  }
};

export const createCategory = async (
  db: ScopedDb,
  spaceId: string,
  input: CreateCategoryRequest,
): Promise<CategoryDTO> => {
  if (input.parentId != null) {
    await validateParent(db, input.parentId, input.kind);
  }

  const last = await db.category.findFirst({
    where: { parentId: input.parentId ?? null, kind: input.kind },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });

  const row = await db.category.create({
    data: {
      spaceId,
      name: input.name,
      kind: input.kind,
      parentId: input.parentId ?? null,
      icon: input.icon ?? null,
      color: input.color ?? null,
      sortOrder: (last?.sortOrder ?? -1) + 1,
      isSystem: false,
    },
    select: SELECT,
  });

  return toDTO(row);
};

export const updateCategory = async (
  db: ScopedDb,
  categoryId: string,
  input: UpdateCategoryRequest,
): Promise<CategoryDTO> => {
  const existing = await db.category.findFirst({
    where: { id: categoryId },
    select: { id: true, kind: true },
  });

  if (existing === null) throw errors.notFound("No se encontró la categoría");

  if (input.parentId != null) {
    await validateParent(db, input.parentId, existing.kind, categoryId);

    // Si esta categoría ya tiene hijas, colgarla de otra crearía un tercer
    // nivel. La regla se sostiene en las dos direcciones.
    const children = await db.category.count({
      where: { parentId: categoryId },
    });
    if (children > 0) {
      throw errors.conflict(
        "CONFLICT",
        "Esta categoría tiene subcategorías: no puede colgar de otra",
      );
    }
  }

  const row = await db.category.update({
    where: { id: categoryId },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.icon !== undefined ? { icon: input.icon } : {}),
      ...(input.color !== undefined ? { color: input.color } : {}),
      ...(input.parentId !== undefined ? { parentId: input.parentId } : {}),
      ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
    },
    select: SELECT,
  });

  return toDTO(row);
};

/**
 * Borrado lógico de una categoría.
 *
 * Los movimientos que la usaban se reasignan a `reassignTo` o quedan sin
 * categoría. No se borran nunca: la clasificación es un dato editable, el
 * movimiento no.
 */
export const deleteCategory = async (
  db: ScopedDb,
  tx: TransactionClient,
  spaceId: string,
  categoryId: string,
  reassignTo: string | undefined,
  actor: { readonly userId: string; readonly name: string },
): Promise<{ readonly reassignedTransactions: number }> => {
  const existing = await db.category.findFirst({
    where: { id: categoryId },
    select: { id: true, name: true, kind: true },
  });

  if (existing === null) throw errors.notFound("No se encontró la categoría");

  if (reassignTo !== undefined) {
    if (reassignTo === categoryId) {
      throw errors.conflict(
        "CONFLICT",
        "No se puede reasignar a la misma categoría que se borra",
      );
    }
    const target = await db.category.findFirst({
      where: { id: reassignTo },
      select: { id: true, kind: true },
    });
    if (target === null) {
      throw errors.notFound("No se encontró la categoría de destino");
    }
    if (target.kind !== existing.kind) {
      throw errors.conflict(
        "CONFLICT",
        "La categoría de destino tiene que ser del mismo tipo",
      );
    }
  }

  const children = await db.category.findMany({
    where: { parentId: categoryId },
    select: { id: true },
  });
  const affected = [categoryId, ...children.map((c) => c.id)];

  const reassigned = await tx.transaction.updateMany({
    where: { spaceId, categoryId: { in: affected } },
    data: { categoryId: reassignTo ?? null },
  });

  // Los presupuestos que apuntaban a la categoría se desactivan: dejarlos
  // activos sin categoría los volvería presupuestos globales por accidente.
  await tx.budget.updateMany({
    where: { spaceId, categoryId: { in: affected } },
    data: { isActive: false },
  });

  const now = new Date();
  await tx.category.updateMany({
    where: { spaceId, id: { in: affected } },
    data: { deletedAt: now },
  });

  await writeAuditLog(tx, {
    spaceId,
    actorUserId: actor.userId,
    actorName: actor.name,
    action: "CATEGORY_DELETED",
    entityType: "Category",
    entityId: categoryId,
    metadata: {
      name: existing.name,
      childrenDeleted: children.length,
      reassignedTransactions: reassigned.count,
      reassignedTo: reassignTo ?? null,
    },
  });

  return { reassignedTransactions: reassigned.count };
};
