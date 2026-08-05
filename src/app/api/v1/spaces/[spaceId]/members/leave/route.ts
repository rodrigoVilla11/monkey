import { z } from "zod";

import { route } from "@/server/api/handler";
import { noContent } from "@/server/api/responses";
import { leaveSpace } from "@/server/services/spaces/members";

export const runtime = "nodejs";

const paramsSchema = z.object({ spaceId: z.string().min(1) });
type Params = z.infer<typeof paramsSchema>;

/**
 * POST /api/v1/spaces/:spaceId/members/leave
 *
 * Abandonar un Space. Rol mínimo VIEWER: cualquiera puede irse.
 * El OWNER no — tiene que transferir la propiedad primero, o el Space quedaría
 * sin dueño.
 */
export const POST = route<undefined, Params>(
  { params: paramsSchema, space: { minRole: "VIEWER" } },
  async ({ access, session, logger }) => {
    await leaveSpace(access.spaceId, {
      userId: access.userId,
      name: session.name,
      role: access.role,
    });
    logger.info("abandonó el espacio");
    return noContent();
  },
);
