import { authResponse } from "@/server/api/auth-response";
import { route } from "@/server/api/handler";
import { RATE_LIMITS } from "@/server/api/rate-limit";
import { getMailer } from "@/server/mail";
import { login } from "@/server/services/auth/login";
import { register } from "@/server/services/auth/register";
import { getProfile } from "@/server/services/auth/profile";
import {
  registerRequestSchema,
  type RegisterRequest,
} from "@/shared/contracts/auth";

export const runtime = "nodejs";

/**
 * POST /api/v1/auth/register
 *
 * Crea la cuenta, su Space personal con el catálogo de categorías, y deja la
 * sesión iniciada. Se puede entrar sin verificar el email, pero los endpoints
 * de dominio responden 403 EMAIL_NOT_VERIFIED hasta que se confirme: así la
 * app puede mostrar la pantalla de "revisá tu correo" en vez de un login vacío.
 */
export const POST = route<RegisterRequest>(
  { body: registerRequestSchema, rateLimit: RATE_LIMITS.register },
  async ({ request, body, ip, logger }) => {
    const { userId, verificationEmailSent } = await register(body, {
      mailer: getMailer(),
    });

    logger.info({ userId, verificationEmailSent }, "usuario registrado");

    const { session } = await login(
      { email: body.email, password: body.password },
      { userAgent: request.headers.get("user-agent") ?? undefined, ip },
    );

    /**
     * 201 aunque el mail no haya salido: la cuenta existe y la sesión está
     * abierta. El flag deja que la pantalla diga la verdad —"tu cuenta está
     * creada, pero no pudimos mandarte el correo"— en vez de fingir que está
     * en camino o, peor, fallar sobre una cuenta ya creada.
     */
    return authResponse(request, await getProfile(userId), session, 201, {
      verificationEmailSent,
    });
  },
);
