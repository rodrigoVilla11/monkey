import { authResponse, extractRefreshToken } from "@/server/api/auth-response";
import { errors } from "@/server/api/errors";
import { route } from "@/server/api/handler";
import { RATE_LIMITS } from "@/server/api/rate-limit";
import { getProfile } from "@/server/services/auth/profile";
import { rotateSession } from "@/server/services/auth/sessions";
import {
  refreshRequestSchema,
  type RefreshRequest,
} from "@/shared/contracts/auth";
import { verifyAccessToken } from "@/server/auth/tokens";

export const runtime = "nodejs";

/**
 * POST /api/v1/auth/refresh
 *
 * No lleva `auth: true`: se llama justamente cuando el access token venció.
 * La credencial es el refresh token, que llega por cookie (web) o en el body
 * (nativo).
 *
 * Cada refresh ROTA el token. Si llega uno ya rotado, se asume copia robada y
 * se cierran todas las sesiones del usuario — ver `rotateSession`.
 */
export const POST = route<RefreshRequest>(
  { body: refreshRequestSchema, rateLimit: RATE_LIMITS.refresh },
  async ({ request, body, ip, logger }) => {
    const token = extractRefreshToken(request, body.refreshToken);
    if (token === null) throw errors.unauthenticated();

    const session = await rotateSession(token, {
      userAgent: request.headers.get("user-agent") ?? undefined,
      ip,
    });

    // El userId sale del token recién firmado, no de nada que mandó el cliente.
    const claims = await verifyAccessToken(session.accessToken);
    if (claims === null) throw errors.internal();

    logger.info({ userId: claims.userId }, "sesión renovada");

    return authResponse(request, await getProfile(claims.userId), session);
  },
);
