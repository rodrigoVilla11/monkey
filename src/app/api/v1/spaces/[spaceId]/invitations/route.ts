import { z } from "zod";

import { route } from "@/server/api/handler";
import { json } from "@/server/api/responses";
import { getMailer } from "@/server/mail";
import {
  createInvitation,
  listInvitations,
} from "@/server/services/spaces/invitations";
import {
  createInvitationRequestSchema,
  type CreateInvitationRequest,
} from "@/shared/contracts/spaces";

export const runtime = "nodejs";

const paramsSchema = z.object({ spaceId: z.string().min(1) });
type Params = z.infer<typeof paramsSchema>;

/** GET — invitaciones pendientes. ADMIN: expone emails de gente ajena al Space. */
export const GET = route<undefined, Params>(
  { params: paramsSchema, space: { minRole: "ADMIN" } },
  async ({ access }) =>
    json({ invitations: await listInvitations(access.spaceId) }),
);

/**
 * POST — invita por email. ADMIN o superior.
 *
 * El rol asignable no incluye OWNER: la propiedad se mueve con
 * transfer-ownership, no invitando.
 */
export const POST = route<CreateInvitationRequest, Params>(
  {
    body: createInvitationRequestSchema,
    params: paramsSchema,
    space: { minRole: "ADMIN" },
  },
  async ({ body, access, session, logger }) => {
    const invitation = await createInvitation(
      access.spaceId,
      { userId: access.userId, name: session.name, role: access.role },
      body,
      { mailer: getMailer() },
    );

    logger.info({ role: body.role }, "invitación enviada");
    return json({ invitation }, { status: 201 });
  },
);
