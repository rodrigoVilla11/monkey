import { systemClient } from "@/server/db/system";
import { hasAtLeast, type MembershipRole } from "@/shared/roles";

import { errors } from "./errors";

/**
 * Resolución del contexto de autorización dentro de un Space.
 *
 * Es la ÚNICA función que convierte un `spaceId` que vino de la URL en un
 * permiso. Devuelve `{ userId, spaceId, role }` o tira.
 *
 * Dos reglas que no son negociables:
 *
 * 1. **El spaceId nunca sale del body ni de la query.** Viene del path
 *    (`/api/v1/spaces/:spaceId/...`) y se contrasta contra Membership antes de
 *    que ningún service lo vea. Un service jamás recibe un spaceId sin validar.
 *
 * 2. **No ser miembro devuelve 404, no 403.** Un 403 confirmaría que el Space
 *    existe, y con eso se puede sondear qué IDs son reales. Solo se responde
 *    403 (INSUFFICIENT_ROLE) cuando SÍ sos miembro pero tu rol no alcanza —
 *    ahí ya sabés que el Space existe, así que no se filtra nada nuevo.
 */

export interface SpaceAccess {
  readonly userId: string;
  readonly spaceId: string;
  readonly role: MembershipRole;
}

export const requireSpaceAccess = async (
  userId: string,
  spaceId: string,
  minRole: MembershipRole,
): Promise<SpaceAccess> => {
  const membership = await systemClient().membership.findUnique({
    where: { userId_spaceId: { userId, spaceId } },
    select: { role: true, space: { select: { deletedAt: true } } },
  });

  // No sos miembro, o el Space está borrado: para vos no existe.
  if (membership?.space.deletedAt !== null) {
    throw errors.notFound("No se encontró el espacio");
  }

  if (!hasAtLeast(membership.role, minRole)) {
    throw errors.insufficientRole(
      `Esta acción necesita rol ${minRole} o superior`,
    );
  }

  return { userId, spaceId, role: membership.role };
};
