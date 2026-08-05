import { route } from "@/server/api/handler";
import { json } from "@/server/api/responses";
import { listSessions } from "@/server/services/auth/sessions";

export const runtime = "nodejs";

/**
 * GET /api/v1/auth/sessions
 *
 * Dispositivos con sesión abierta. `current: true` marca el que está mirando,
 * para que la UI no ofrezca "cerrar" sin avisar que se está cerrando a sí mismo.
 */
export const GET = route({ auth: true }, async ({ session }) => {
  const sessions = await listSessions(session.userId, session.sessionId);
  return json({ sessions });
});
