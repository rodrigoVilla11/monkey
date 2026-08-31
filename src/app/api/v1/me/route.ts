import { route } from "@/server/api/handler";
import { json } from "@/server/api/responses";
import { getProfile, updateProfile } from "@/server/services/auth/profile";
import {
  updateProfileRequestSchema,
  type UpdateProfileRequest,
} from "@/shared/contracts/auth";

export const runtime = "nodejs";

/**
 * GET /api/v1/me
 *
 * Es el primer request de la app al arrancar: dice quién sos, si tenés el email
 * verificado y qué Space tenías abierto. Sin `verified: true` a propósito — la
 * app necesita poder leer el perfil para saber que hay que mostrar la pantalla
 * de verificación.
 */
export const GET = route({ auth: true }, async ({ session }) =>
  json({ user: await getProfile(session.userId) }),
);

/**
 * PATCH /api/v1/me
 *
 * Nombre, timezone, locale, tema, moneda preferida y primer día de la semana.
 * El email no se cambia por acá: eso necesitaría su propio flujo de
 * verificación de la nueva dirección.
 */
export const PATCH = route<UpdateProfileRequest>(
  { body: updateProfileRequestSchema, auth: true, verified: true },
  async ({ body, session }) =>
    json({ user: await updateProfile(session.userId, body) }),
);
