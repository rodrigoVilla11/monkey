import { errors } from "@/server/api/errors";
import { systemClient } from "@/server/db/system";
import type {
  SessionUser,
  UpdateProfileRequest,
} from "@/shared/contracts/auth";

/**
 * Perfil del usuario y Space activo.
 *
 * `activeSpaceId` es SOLO el default de la UI: recuerda qué Space tenía abierto
 * la persona. No otorga ningún permiso. La autorización real sale siempre del
 * spaceId de la URL contrastado con Membership en `requireSpaceAccess()`.
 */

const toSessionUser = (user: {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  timezone: string;
  locale: string;
  theme: "SYSTEM" | "LIGHT" | "DARK";
  weekStartsOn: number;
  preferredCurrency: string;
  emailVerifiedAt: Date | null;
  activeSpaceId: string | null;
}): SessionUser => ({
  id: user.id,
  email: user.email,
  name: user.name,
  avatarUrl: user.avatarUrl,
  timezone: user.timezone,
  locale: user.locale,
  theme: user.theme,
  weekStartsOn: user.weekStartsOn,
  preferredCurrency: user.preferredCurrency,
  emailVerified: user.emailVerifiedAt !== null,
  activeSpaceId: user.activeSpaceId,
});

const SELECT = {
  id: true,
  email: true,
  name: true,
  avatarUrl: true,
  timezone: true,
  locale: true,
  theme: true,
  weekStartsOn: true,
  preferredCurrency: true,
  emailVerifiedAt: true,
  activeSpaceId: true,
} as const;

export const getProfile = async (userId: string): Promise<SessionUser> => {
  const user = await systemClient().user.findUnique({
    where: { id: userId },
    select: SELECT,
  });

  if (user === null) throw errors.notFound("No se encontró el usuario");
  return toSessionUser(user);
};

export const updateProfile = async (
  userId: string,
  input: UpdateProfileRequest,
): Promise<SessionUser> => {
  const user = await systemClient().user.update({
    where: { id: userId },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
      ...(input.locale !== undefined ? { locale: input.locale } : {}),
      ...(input.theme !== undefined ? { theme: input.theme } : {}),
      ...(input.weekStartsOn !== undefined
        ? { weekStartsOn: input.weekStartsOn }
        : {}),
      ...(input.preferredCurrency !== undefined
        ? { preferredCurrency: input.preferredCurrency }
        : {}),
      ...(input.avatarUrl !== undefined ? { avatarUrl: input.avatarUrl } : {}),
    },
    select: SELECT,
  });

  return toSessionUser(user);
};

/**
 * Cambia el Space activo.
 *
 * Verifica la membresía antes de guardarlo. Aunque `activeSpaceId` no otorgue
 * permisos, dejar que alguien apunte a un Space ajeno haría que la UI intentara
 * cargarlo y recibiera 404s sin explicación.
 */
export const setActiveSpace = async (
  userId: string,
  spaceId: string,
): Promise<SessionUser> => {
  const db = systemClient();

  const membership = await db.membership.findUnique({
    where: { userId_spaceId: { userId, spaceId } },
    select: { id: true, space: { select: { deletedAt: true } } },
  });

  // 404 y no 403: no se confirma que el Space exista.
  // Cubre "no sos miembro" y "el Space está borrado" con la misma respuesta.
  if (membership?.space.deletedAt !== null) {
    throw errors.notFound("No se encontró el espacio");
  }

  const user = await db.user.update({
    where: { id: userId },
    data: { activeSpaceId: spaceId },
    select: SELECT,
  });

  return toSessionUser(user);
};
