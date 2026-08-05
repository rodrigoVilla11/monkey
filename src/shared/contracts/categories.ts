import { z } from "zod";

import { cuidSchema, hexColorSchema, iconSchema } from "./common";

/**
 * Categorías. Jerarquía de máximo dos niveles.
 *
 * Módulo puro: sin Next, sin Prisma, sin React.
 */

export const CATEGORY_KINDS = ["INCOME", "EXPENSE"] as const;
export type CategoryKind = (typeof CATEGORY_KINDS)[number];

export const createCategoryRequestSchema = z.object({
  name: z.string().trim().min(1, "El nombre es obligatorio").max(60),
  kind: z.enum(CATEGORY_KINDS),
  /**
   * Categoría padre. El service verifica que exista, que sea del mismo `kind`
   * y que NO tenga padre a su vez: el esquema admite jerarquía infinita, la
   * regla de dos niveles se hace cumplir en el service.
   */
  parentId: cuidSchema.nullable().optional(),
  icon: iconSchema.nullable().optional(),
  color: hexColorSchema.nullable().optional(),
});

export const updateCategoryRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(60).optional(),
    icon: iconSchema.nullable().optional(),
    color: hexColorSchema.nullable().optional(),
    parentId: cuidSchema.nullable().optional(),
    sortOrder: z.number().int().min(0).max(9999).optional(),
    /**
     * `kind` no se puede cambiar: una categoría de gasto con movimientos
     * cargados no puede volverse de ingreso sin invertir el signo de todo lo
     * que cuelga de ella.
     */
  })
  .refine(
    (value) => Object.keys(value).length > 0,
    "Hay que mandar al menos un campo",
  );

/**
 * Al borrar una categoría con movimientos hay que decidir qué pasa con ellos.
 * No hay default: obligar a elegir evita el borrado accidental de la
 * clasificación de un año entero.
 */
export const deleteCategoryQuerySchema = z.object({
  /** Categoría a la que reasignar los movimientos. Si no viene, quedan sin categoría. */
  reassignTo: cuidSchema.optional(),
});

export type CreateCategoryRequest = z.infer<typeof createCategoryRequestSchema>;
export type UpdateCategoryRequest = z.infer<typeof updateCategoryRequestSchema>;

export interface CategoryDTO {
  readonly id: string;
  readonly name: string;
  readonly kind: CategoryKind;
  readonly parentId: string | null;
  readonly icon: string | null;
  readonly color: string | null;
  readonly sortOrder: number;
  readonly isSystem: boolean;
}

/** Categoría con sus hijas, para el grid de la carga rápida. */
export interface CategoryTreeNode extends CategoryDTO {
  readonly children: readonly CategoryDTO[];
}
