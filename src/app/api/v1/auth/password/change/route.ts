import { clearedSessionCookies } from "@/server/api/auth-response";
import { route } from "@/server/api/handler";
import { noContent } from "@/server/api/responses";
import { getMailer } from "@/server/mail";
import { changePassword } from "@/server/services/auth/password-flows";
import {
  changePasswordRequestSchema,
  type ChangePasswordRequest,
} from "@/shared/contracts/auth";

export const runtime = "nodejs";

/**
 * POST /api/v1/auth/password/change
 *
 * Pide la contraseña actual: sin eso, un token robado permitiría tomar la
 * cuenta para siempre cambiando la contraseña.
 *
 * También cierra todas las sesiones, incluida la que hizo el cambio. Es
 * intencional: si cambiás la contraseña por sospecha, querés echar a todos, y
 * volver a entrar es un trámite de diez segundos.
 */
export const POST = route<ChangePasswordRequest>(
  { body: changePasswordRequestSchema, auth: true, verified: true },
  async ({ body, session, logger }) => {
    await changePassword(
      session.userId,
      body.currentPassword,
      body.newPassword,
      { mailer: getMailer() },
    );

    logger.info("contraseña cambiada desde el perfil");
    return noContent(clearedSessionCookies());
  },
);
