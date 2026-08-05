import { route } from "@/server/api/handler";
import { noContent } from "@/server/api/responses";
import { verifyEmail } from "@/server/services/auth/password-flows";
import {
  verifyEmailRequestSchema,
  type VerifyEmailRequest,
} from "@/shared/contracts/auth";

export const runtime = "nodejs";

/**
 * POST /api/v1/auth/verify-email
 *
 * Sin sesión: el enlace del mail se abre en cualquier navegador, y en iOS un
 * PWA instalado tiene cookie jar separado de Safari — con `auth: true` esto
 * fallaría justo en el caso más común.
 */
export const POST = route<VerifyEmailRequest>(
  { body: verifyEmailRequestSchema },
  async ({ body }) => {
    await verifyEmail(body.token);
    return noContent();
  },
);
