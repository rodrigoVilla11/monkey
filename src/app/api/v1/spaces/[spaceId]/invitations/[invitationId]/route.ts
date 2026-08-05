import { z } from "zod";

import { route } from "@/server/api/handler";
import { noContent } from "@/server/api/responses";
import { revokeInvitation } from "@/server/services/spaces/invitations";

export const runtime = "nodejs";

const paramsSchema = z.object({
  spaceId: z.string().min(1),
  invitationId: z.string().min(1),
});
type Params = z.infer<typeof paramsSchema>;

/**
 * DELETE — revoca una invitación pendiente. ADMIN o superior.
 *
 * El service filtra por spaceId además de por id: mandar el id de una
 * invitación de otro Space da 404, no una revocación ajena.
 */
export const DELETE = route<undefined, Params>(
  { params: paramsSchema, space: { minRole: "ADMIN" } },
  async ({ params, access, session }) => {
    await revokeInvitation(
      access.spaceId,
      { userId: access.userId, name: session.name, role: access.role },
      params.invitationId,
    );
    return noContent();
  },
);
