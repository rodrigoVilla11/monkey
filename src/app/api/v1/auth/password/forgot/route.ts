import { route } from "@/server/api/handler";
import { RATE_LIMITS } from "@/server/api/rate-limit";
import { noContent } from "@/server/api/responses";
import { getMailer } from "@/server/mail";
import { requestPasswordReset } from "@/server/services/auth/password-flows";
import {
  forgotPasswordRequestSchema,
  type ForgotPasswordRequest,
} from "@/shared/contracts/auth";

export const runtime = "nodejs";

/**
 * POST /api/v1/auth/password/forgot
 *
 * SIEMPRE responde 204, exista o no el email. Nunca revela si hay cuenta:
 * distinguir "te mandamos un mail" de "ese email no existe" convierte este
 * endpoint en un verificador de cuentas.
 */
export const POST = route<ForgotPasswordRequest>(
  { body: forgotPasswordRequestSchema, rateLimit: RATE_LIMITS.forgotPassword },
  async ({ body }) => {
    await requestPasswordReset(body.email, { mailer: getMailer() });
    return noContent();
  },
);
