import { z } from "zod";

import { route } from "@/server/api/handler";
import { json } from "@/server/api/responses";
import { listMembers } from "@/server/services/spaces/members";

export const runtime = "nodejs";

const paramsSchema = z.object({ spaceId: z.string().min(1) });
type Params = z.infer<typeof paramsSchema>;

/**
 * GET /api/v1/spaces/:spaceId/members
 *
 * Cualquier miembro puede ver quiénes están: en un espacio compartido, cada
 * transacción muestra el avatar de quien la cargó, así que la lista hace falta
 * incluso con rol VIEWER.
 */
export const GET = route<undefined, Params>(
  { params: paramsSchema, space: { minRole: "VIEWER" } },
  async ({ access }) =>
    json({ members: await listMembers(access.spaceId, access.userId) }),
);
