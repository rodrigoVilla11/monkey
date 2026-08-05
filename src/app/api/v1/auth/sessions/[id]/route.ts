import { z } from "zod";

import { route } from "@/server/api/handler";
import { noContent } from "@/server/api/responses";
import { revokeSessionById } from "@/server/services/auth/sessions";

export const runtime = "nodejs";

const paramsSchema = z.object({ id: z.string().min(1) });
type Params = z.infer<typeof paramsSchema>;

/**
 * DELETE /api/v1/auth/sessions/:id
 *
 * Cierra un dispositivo concreto. El service filtra por `userId` además de por
 * `id`, así que mandar el id de la sesión de otra persona da 404, no un cierre
 * ajeno.
 */
export const DELETE = route<undefined, Params>(
  { auth: true, params: paramsSchema },
  async ({ params, session }) => {
    await revokeSessionById(session.userId, params.id);
    return noContent();
  },
);
