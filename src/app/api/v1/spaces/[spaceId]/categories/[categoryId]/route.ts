import { z } from "zod";

import { route } from "@/server/api/handler";
import { json } from "@/server/api/responses";
import { systemClient } from "@/server/db/system";
import { deleteCategory, updateCategory } from "@/server/services/categories";
import {
  updateCategoryRequestSchema,
  type UpdateCategoryRequest,
} from "@/shared/contracts/categories";

export const runtime = "nodejs";

const paramsSchema = z.object({
  spaceId: z.string().min(1),
  categoryId: z.string().min(1),
  /** Categoría a la que mover los movimientos. Si no viene, quedan sin categoría. */
  reassignTo: z.string().min(1).optional(),
});
type Params = z.infer<typeof paramsSchema>;

export const PATCH = route<UpdateCategoryRequest, Params>(
  {
    body: updateCategoryRequestSchema,
    params: paramsSchema,
    space: { minRole: "MEMBER" },
  },
  async ({ body, params, db }) =>
    json({ category: await updateCategory(db, params.categoryId, body) }),
);

/**
 * DELETE — borrado lógico, arrastrando las subcategorías.
 *
 * Los movimientos NO se borran: se reasignan a `?reassignTo=` o quedan sin
 * categoría. La clasificación es un dato editable; el movimiento, no.
 */
export const DELETE = route<undefined, Params>(
  { params: paramsSchema, space: { minRole: "MEMBER" } },
  async ({ params, access, session, db }) => {
    const result = await systemClient().$transaction(async (tx) =>
      deleteCategory(
        db,
        tx,
        access.spaceId,
        params.categoryId,
        params.reassignTo,
        {
          userId: access.userId,
          name: session.name,
        },
      ),
    );

    return json(result);
  },
);
