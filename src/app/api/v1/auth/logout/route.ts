import {
  clearedSessionCookies,
  extractRefreshToken,
} from "@/server/api/auth-response";
import { route } from "@/server/api/handler";
import { noContent } from "@/server/api/responses";
import { revokeSessionByToken } from "@/server/services/auth/sessions";
import {
  refreshRequestSchema,
  type RefreshRequest,
} from "@/shared/contracts/auth";

export const runtime = "nodejs";

/**
 * POST /api/v1/auth/logout
 *
 * Cierra SOLO la sesión actual; el resto de los dispositivos siguen dentro.
 * Para cerrar todos está /auth/sessions/revoke-all.
 *
 * Sin `auth: true` a propósito: cerrar sesión con un access token ya vencido
 * tiene que funcionar igual, o el refresh token quedaría vivo en la base.
 * Siempre responde 204 y limpia las cookies, incluso si el token ya no valía.
 */
export const POST = route<RefreshRequest>(
  { body: refreshRequestSchema },
  async ({ request, body }) => {
    const token = extractRefreshToken(request, body.refreshToken);
    if (token !== null) await revokeSessionByToken(token);

    return noContent(clearedSessionCookies());
  },
);
