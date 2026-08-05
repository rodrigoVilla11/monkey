import { z } from "zod";

import { route } from "@/server/api/handler";
import { json } from "@/server/api/responses";
import { acceptInvitation } from "@/server/services/spaces/invitations";

export const runtime = "nodejs";

const paramsSchema = z.object({ token: z.string().min(1) });
type Params = z.infer<typeof paramsSchema>;

/**
 * POST /api/v1/invitations/:token/accept
 *
 * Necesita sesión y email verificado. El service además exige que el email de
 * la sesión COINCIDA con el de la invitación: sin eso, cualquiera con el
 * enlace entraría al Space, y los enlaces viajan por mail, se reenvían y
 * quedan en historiales.
 *
 * Al aceptar, el Space nuevo pasa a ser el activo.
 */
export const POST = route<undefined, Params>(
  { params: paramsSchema, auth: true, verified: true },
  async ({ params, session, logger }) => {
    const result = await acceptInvitation(params.token, {
      id: session.userId,
      email: session.email,
      name: session.name,
    });

    logger.info({ spaceId: result.spaceId }, "invitación aceptada");
    return json({ space: result });
  },
);
