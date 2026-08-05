import { z } from "zod";

import { route } from "@/server/api/handler";
import { json, noContent } from "@/server/api/responses";
import {
  deleteSpace,
  getSpace,
  updateSpace,
} from "@/server/services/spaces/spaces";
import {
  updateSpaceRequestSchema,
  type UpdateSpaceRequest,
} from "@/shared/contracts/spaces";

export const runtime = "nodejs";

const paramsSchema = z.object({ spaceId: z.string().min(1) });
type Params = z.infer<typeof paramsSchema>;

/** GET — cualquier miembro. */
export const GET = route<undefined, Params>(
  { params: paramsSchema, space: { minRole: "VIEWER" } },
  async ({ access }) =>
    json({ space: await getSpace(access.spaceId, access.role) }),
);

/** PATCH — ADMIN. La moneda primaria no se puede cambiar (ver el contrato). */
export const PATCH = route<UpdateSpaceRequest, Params>(
  {
    body: updateSpaceRequestSchema,
    params: paramsSchema,
    space: { minRole: "ADMIN" },
  },
  async ({ body, access, session }) =>
    json({
      space: await updateSpace(
        access.spaceId,
        access.userId,
        session.name,
        access.role,
        body,
      ),
    }),
);

/**
 * DELETE — solo OWNER.
 *
 * Borrado lógico. No se puede borrar el último Space de una persona: quedaría
 * con sesión abierta y sin ningún lugar donde cargar nada.
 */
export const DELETE = route<undefined, Params>(
  { params: paramsSchema, space: { minRole: "OWNER" } },
  async ({ access, session, logger }) => {
    await deleteSpace(access.spaceId, access.userId, session.name);
    logger.warn("espacio eliminado");
    return noContent();
  },
);
