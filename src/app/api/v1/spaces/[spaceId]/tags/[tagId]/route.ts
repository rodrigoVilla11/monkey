import { z } from "zod";

import { errors } from "@/server/api/errors";
import { route } from "@/server/api/handler";
import { json, noContent } from "@/server/api/responses";
import {
  updateTagRequestSchema,
  type UpdateTagRequest,
} from "@/shared/contracts/transactions";

export const runtime = "nodejs";

const paramsSchema = z.object({
  spaceId: z.string().min(1),
  tagId: z.string().min(1),
});
type Params = z.infer<typeof paramsSchema>;

export const PATCH = route<UpdateTagRequest, Params>(
  {
    body: updateTagRequestSchema,
    params: paramsSchema,
    space: { minRole: "MEMBER" },
  },
  async ({ body, params, db }) => {
    const existing = await db.tag.findFirst({
      where: { id: params.tagId },
      select: { id: true },
    });
    if (existing === null) throw errors.notFound("No se encontró la etiqueta");

    const tag = await db.tag.update({
      where: { id: params.tagId },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.color !== undefined ? { color: body.color } : {}),
      },
      select: { id: true, name: true, color: true },
    });

    return json({ tag });
  },
);

/**
 * DELETE — borrado lógico.
 *
 * Los vínculos con las transacciones se borran de verdad: una etiqueta que ya
 * no existe no tiene por qué seguir apareciendo en un movimiento. El
 * movimiento en sí no se toca.
 */
export const DELETE = route<undefined, Params>(
  { params: paramsSchema, space: { minRole: "MEMBER" } },
  async ({ params, db }) => {
    const existing = await db.tag.findFirst({
      where: { id: params.tagId },
      select: { id: true },
    });
    if (existing === null) throw errors.notFound("No se encontró la etiqueta");

    await db.transactionTag.deleteMany({ where: { tagId: params.tagId } });
    await db.tag.update({
      where: { id: params.tagId },
      data: { deletedAt: new Date() },
    });

    return noContent();
  },
);
