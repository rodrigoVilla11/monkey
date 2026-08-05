import { clearedSessionCookies } from "@/server/api/auth-response";
import { route } from "@/server/api/handler";
import { noContent } from "@/server/api/responses";
import { revokeAllSessions } from "@/server/services/auth/sessions";

export const runtime = "nodejs";

/**
 * POST /api/v1/auth/sessions/revoke-all
 *
 * "Cerrar sesión en todos los dispositivos", incluido este.
 *
 * Revoca los refresh tokens y además marca `User.sessionsRevokedAt`, que
 * `resolveSession` compara con el `iat` de cada access token. Sin esa segunda
 * parte, los access tokens ya emitidos seguirían valiendo hasta 15 minutos.
 */
export const POST = route({ auth: true }, async ({ session, logger }) => {
  await revokeAllSessions(session.userId, "revocación manual del usuario");
  logger.info("todas las sesiones cerradas");
  return noContent(clearedSessionCookies());
});
