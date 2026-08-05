import { clearedSessionCookies } from "@/server/api/auth-response";
import { route } from "@/server/api/handler";
import { noContent } from "@/server/api/responses";
import { getMailer } from "@/server/mail";
import { resetPassword } from "@/server/services/auth/password-flows";
import {
  resetPasswordRequestSchema,
  type ResetPasswordRequest,
} from "@/shared/contracts/auth";

export const runtime = "nodejs";

/**
 * POST /api/v1/auth/password/reset
 *
 * Cierra todas las sesiones activas al completarse, y limpia las cookies de
 * este navegador. Quien restablece su contraseña suele hacerlo porque sospecha
 * que alguien más entró: dejarle la sesión vieja abierta a ese alguien sería
 * absurdo.
 */
export const POST = route<ResetPasswordRequest>(
  { body: resetPasswordRequestSchema },
  async ({ body, logger }) => {
    await resetPassword(body.token, body.password, { mailer: getMailer() });
    logger.info("contraseña restablecida y sesiones cerradas");
    return noContent(clearedSessionCookies());
  },
);
