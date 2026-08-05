import { z } from "zod";

import { route } from "@/server/api/handler";
import { json } from "@/server/api/responses";
import { createCategory, listCategories } from "@/server/services/categories";
import {
  CATEGORY_KINDS,
  createCategoryRequestSchema,
  type CreateCategoryRequest,
} from "@/shared/contracts/categories";

export const runtime = "nodejs";

const paramsSchema = z.object({
  spaceId: z.string().min(1),
  kind: z.enum(CATEGORY_KINDS).optional(),
});
type Params = z.infer<typeof paramsSchema>;

/**
 * GET — árbol de categorías (padres con sus hijas).
 *
 * Se devuelve ya anidado porque es lo que consume el grid de íconos de la
 * carga rápida: aplanarlo y volver a armarlo en el cliente sería trabajo
 * repetido en cada render.
 */
export const GET = route<undefined, Params>(
  { params: paramsSchema, space: { minRole: "VIEWER" } },
  async ({ params, db }) =>
    json({ categories: await listCategories(db, params.kind) }),
);

export const POST = route<CreateCategoryRequest, Params>(
  {
    body: createCategoryRequestSchema,
    params: paramsSchema,
    space: { minRole: "MEMBER" },
  },
  async ({ body, access, db }) =>
    json(
      { category: await createCategory(db, access.spaceId, body) },
      { status: 201 },
    ),
);
