import { z } from "zod";

import { route } from "@/server/api/handler";
import { noContent } from "@/server/api/responses";
import {
  changeMemberRole,
  removeMember,
} from "@/server/services/spaces/members";
import {
  updateMemberRequestSchema,
  type UpdateMemberRequest,
} from "@/shared/contracts/spaces";

export const runtime = "nodejs";

const paramsSchema = z.object({
  spaceId: z.string().min(1),
  userId: z.string().min(1),
});
type Params = z.infer<typeof paramsSchema>;

/**
 * PATCH — cambia el rol de un miembro. ADMIN o superior.
 *
 * El rol mínimo del endpoint es solo la primera barrera. El service aplica
 * `canManageMember`, que además impide tocar al OWNER y que un ADMIN toque a
 * otro ADMIN.
 */
export const PATCH = route<UpdateMemberRequest, Params>(
  {
    body: updateMemberRequestSchema,
    params: paramsSchema,
    space: { minRole: "ADMIN" },
  },
  async ({ body, params, access, session, logger }) => {
    await changeMemberRole(
      access.spaceId,
      { userId: access.userId, name: session.name, role: access.role },
      params.userId,
      body.role,
    );
    logger.info(
      { targetUserId: params.userId, role: body.role },
      "rol cambiado",
    );
    return noContent();
  },
);

/** DELETE — expulsa a un miembro. ADMIN o superior, con las mismas reglas. */
export const DELETE = route<undefined, Params>(
  { params: paramsSchema, space: { minRole: "ADMIN" } },
  async ({ params, access, session, logger }) => {
    await removeMember(
      access.spaceId,
      { userId: access.userId, name: session.name, role: access.role },
      params.userId,
    );
    logger.info({ targetUserId: params.userId }, "miembro expulsado");
    return noContent();
  },
);
