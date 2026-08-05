import { type z } from "zod";

import { route } from "@/server/api/handler";
import { json } from "@/server/api/responses";
import { setActiveSpace } from "@/server/services/auth/profile";
import { setActiveSpaceRequestSchema } from "@/shared/contracts/auth";

export const runtime = "nodejs";

type Body = z.infer<typeof setActiveSpaceRequestSchema>;

/**
 * PUT /api/v1/me/active-space
 *
 * Recuerda qué Space estabas usando. NO otorga permisos: la autorización sale
 * siempre del spaceId de la URL contra Membership. Si el Space no es tuyo,
 * responde 404 (no 403), para no confirmar que existe.
 */
export const PUT = route<Body>(
  { body: setActiveSpaceRequestSchema, auth: true, verified: true },
  async ({ body, session }) =>
    json({ user: await setActiveSpace(session.userId, body.spaceId) }),
);
