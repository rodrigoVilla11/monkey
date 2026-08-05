import { authResponse } from "@/server/api/auth-response";
import { route } from "@/server/api/handler";
import { RATE_LIMITS } from "@/server/api/rate-limit";
import { login } from "@/server/services/auth/login";
import { getProfile } from "@/server/services/auth/profile";
import { loginRequestSchema, type LoginRequest } from "@/shared/contracts/auth";

export const runtime = "nodejs";

/**
 * POST /api/v1/auth/login
 *
 * Rate limit por IP acá, y bloqueo por cuenta dentro del service (que sobrevive
 * a los redeploys). Ver el comentario de `services/auth/login.ts`.
 */
export const POST = route<LoginRequest>(
  { body: loginRequestSchema, rateLimit: RATE_LIMITS.login },
  async ({ request, body, ip, logger }) => {
    const { session, userId } = await login(body, {
      userAgent: request.headers.get("user-agent") ?? undefined,
      ip,
    });

    logger.info({ userId, sessionId: session.sessionId }, "sesión iniciada");

    return authResponse(request, await getProfile(userId), session);
  },
);
