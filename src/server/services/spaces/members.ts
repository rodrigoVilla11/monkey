import { errors } from "@/server/api/errors";
import { systemClient } from "@/server/db/system";
import { writeAuditLog } from "@/server/services/audit/log";
import type { SpaceMember } from "@/shared/contracts/spaces";
import {
  canManageMember,
  type AssignableRole,
  type MembershipRole,
} from "@/shared/roles";

/**
 * Gestión de miembros de un Space.
 *
 * Las reglas de quién puede tocar a quién viven en `shared/roles.ts`
 * (`canManageMember`) para que el cliente pueda usar las mismas y no ofrecer
 * botones que van a fallar. Pero el chequeo que MANDA es este, en el servidor.
 */

export const listMembers = async (
  spaceId: string,
  viewerId: string,
): Promise<SpaceMember[]> => {
  const rows = await systemClient().membership.findMany({
    where: { spaceId },
    orderBy: [{ role: "asc" }, { joinedAt: "asc" }],
    select: {
      userId: true,
      role: true,
      joinedAt: true,
      user: {
        select: { name: true, email: true, avatarUrl: true },
      },
    },
  });

  return rows.map((row) => ({
    userId: row.userId,
    name: row.user.name,
    email: row.user.email,
    avatarUrl: row.user.avatarUrl,
    role: row.role,
    joinedAt: row.joinedAt.toISOString(),
    isSelf: row.userId === viewerId,
  }));
};

interface ActorContext {
  readonly userId: string;
  readonly name: string;
  readonly role: MembershipRole;
}

const loadTarget = async (spaceId: string, targetUserId: string) => {
  const membership = await systemClient().membership.findUnique({
    where: { userId_spaceId: { userId: targetUserId, spaceId } },
    select: { id: true, role: true, user: { select: { name: true } } },
  });

  if (membership === null) throw errors.notFound("No se encontró el miembro");
  return membership;
};

export const changeMemberRole = async (
  spaceId: string,
  actor: ActorContext,
  targetUserId: string,
  role: AssignableRole,
): Promise<void> => {
  if (targetUserId === actor.userId) {
    // Un OWNER que se degradara a sí mismo dejaría el Space sin dueño.
    // El camino correcto es transfer-ownership.
    throw errors.conflict(
      "CONFLICT",
      "No podés cambiar tu propio rol. Usá la transferencia de propiedad",
    );
  }

  const target = await loadTarget(spaceId, targetUserId);

  if (!canManageMember(actor.role, target.role)) {
    throw errors.insufficientRole(
      target.role === "OWNER"
        ? "No se puede cambiar el rol del propietario"
        : "Tu rol no alcanza para gestionar a este miembro",
    );
  }

  const db = systemClient();

  await db.$transaction(async (tx) => {
    await tx.membership.update({
      where: { id: target.id },
      data: { role },
    });

    await writeAuditLog(tx, {
      spaceId,
      actorUserId: actor.userId,
      actorName: actor.name,
      action: "MEMBER_ROLE_CHANGED",
      entityType: "Membership",
      entityId: target.id,
      metadata: { targetUserId, from: target.role, to: role },
    });
  });
};

export const removeMember = async (
  spaceId: string,
  actor: ActorContext,
  targetUserId: string,
): Promise<void> => {
  if (targetUserId === actor.userId) {
    throw errors.conflict(
      "CONFLICT",
      "Para salir del espacio usá la acción de abandonar",
    );
  }

  const target = await loadTarget(spaceId, targetUserId);

  if (!canManageMember(actor.role, target.role)) {
    throw errors.insufficientRole(
      target.role === "OWNER"
        ? "No se puede expulsar al propietario"
        : "Tu rol no alcanza para gestionar a este miembro",
    );
  }

  await removeMembership(
    spaceId,
    target.id,
    targetUserId,
    actor,
    "MEMBER_REMOVED",
  );
};

/**
 * Abandonar un Space por voluntad propia.
 *
 * El OWNER no puede irse sin transferir primero: dejaría el Space sin dueño y
 * el índice único parcial de la base garantiza que siempre haya exactamente
 * uno.
 */
export const leaveSpace = async (
  spaceId: string,
  actor: ActorContext,
): Promise<void> => {
  if (actor.role === "OWNER") {
    throw errors.conflict(
      "CONFLICT",
      "Transferí la propiedad del espacio antes de abandonarlo",
    );
  }

  const membership = await loadTarget(spaceId, actor.userId);
  await removeMembership(
    spaceId,
    membership.id,
    actor.userId,
    actor,
    "MEMBER_LEFT",
  );
};

const removeMembership = async (
  spaceId: string,
  membershipId: string,
  targetUserId: string,
  actor: ActorContext,
  action: "MEMBER_REMOVED" | "MEMBER_LEFT",
): Promise<void> => {
  const db = systemClient();

  await db.$transaction(async (tx) => {
    await tx.membership.delete({ where: { id: membershipId } });

    // Si tenía este Space como activo, se lo saca: ya no puede entrar.
    await tx.user.updateMany({
      where: { id: targetUserId, activeSpaceId: spaceId },
      data: { activeSpaceId: null },
    });

    /**
     * Las transacciones que cargó NO se borran ni se anonimizan: son datos del
     * Space, no de la persona. `createdByUserId` sigue apuntando al usuario
     * (que existe, solo que ya no es miembro) y `createdByName` conserva el
     * nombre aunque algún día se borre la cuenta.
     */
    await writeAuditLog(tx, {
      spaceId,
      actorUserId: actor.userId,
      actorName: actor.name,
      action,
      entityType: "Membership",
      entityId: membershipId,
      metadata: { targetUserId },
    });
  });
};

/**
 * Transferencia de propiedad.
 *
 * Se hace en una transacción y en dos pasos —degradar al actual, promover al
 * nuevo— porque hay un índice único parcial que impide que existan dos OWNER
 * a la vez, aunque sea por un instante.
 *
 * Quien transfiere queda como ADMIN: sigue gestionando todo salvo eliminar el
 * Space. Quitarle el acceso de golpe sería una sorpresa desagradable.
 */
export const transferOwnership = async (
  spaceId: string,
  actor: ActorContext,
  targetUserId: string,
): Promise<void> => {
  if (targetUserId === actor.userId) {
    throw errors.conflict("CONFLICT", "Ya sos el propietario del espacio");
  }

  const target = await loadTarget(spaceId, targetUserId);
  const db = systemClient();

  const current = await db.membership.findUnique({
    where: { userId_spaceId: { userId: actor.userId, spaceId } },
    select: { id: true },
  });

  if (current === null) throw errors.notFound("No se encontró tu membresía");

  await db.$transaction(async (tx) => {
    // Primero degradar: si se promoviera antes, habría dos OWNER un instante
    // y el índice único parcial rechazaría la operación.
    await tx.membership.update({
      where: { id: current.id },
      data: { role: "ADMIN" },
    });

    await tx.membership.update({
      where: { id: target.id },
      data: { role: "OWNER" },
    });

    await writeAuditLog(tx, {
      spaceId,
      actorUserId: actor.userId,
      actorName: actor.name,
      action: "SPACE_OWNERSHIP_TRANSFERRED",
      entityType: "Space",
      entityId: spaceId,
      metadata: { from: actor.userId, to: targetUserId },
    });
  });
};
