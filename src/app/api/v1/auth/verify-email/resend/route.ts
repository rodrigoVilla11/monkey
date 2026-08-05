import { route } from "@/server/api/handler";
import { RATE_LIMITS } from "@/server/api/rate-limit";
import { noContent } from "@/server/api/responses";
import { getMailer } from "@/server/mail";
import { resendVerification } from "@/server/services/auth/password-flows";

export const runtime = "nodejs";

/**
 * POST /api/v1/auth/verify-email/resend
 *
 * `auth: true` pero SIN `verified: true`: es el único endpoint que una cuenta
 * sin verificar necesita poder llamar.
 */
export const POST = route(
  { auth: true, rateLimit: RATE_LIMITS.resendVerification },
  async ({ session }) => {
    await resendVerification(session.userId, { mailer: getMailer() });
    return noContent();
  },
);
