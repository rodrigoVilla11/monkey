import { env } from "@/env";
import { errors } from "@/server/api/errors";
import { systemClient } from "@/server/db/system";
import { writeAuditLog } from "@/server/services/audit/log";
import { seedCategories } from "@/server/services/auth/register";
import type {
  CreateSpaceRequest,
  SpaceSummary,
  UpdateSpaceRequest,
} from "@/shared/contracts/spaces";
import type { MembershipRole } from "@/shared/roles";

/**
 * Ciclo de vida de un Space.
 *
 * Crear un Space no pasa por `forSpace()` por una razón evidente: el Space
 * todavía no existe cuando arranca la operación. Es uno de los usos legítimos
 * de `systemClient()` documentados en `db/system.ts`.
 */

const toSummary = (
  row: {
    id: string;
    name: string;
    primaryCurrency: string;
    timezone: string;
    icon: string | null;
    color: string | null;
    isPersonal: boolean;
    createdAt: Date;
    _count?: { memberships: number };
  },
  role: MembershipRole,
): SpaceSummary => ({
  id: row.id,
  name: row.name,
  primaryCurrency: row.primaryCurrency,
  timezone: row.timezone,
  icon: row.icon,
  color: row.color,
  isPersonal: row.isPersonal,
  role,
  memberCount: row._count?.memberships ?? 1,
  createdAt: row.createdAt.toISOString(),
});

/** Todos los Spaces del usuario, con su rol en cada uno. */
export const listSpaces = async (userId: string): Promise<SpaceSummary[]> => {
  const memberships = await systemClient().membership.findMany({
    where: { userId, space: { deletedAt: null } },
    orderBy: [{ space: { isPersonal: "desc" } }, { joinedAt: "asc" }],
    select: {
      role: true,
      space: {
        select: {
          id: true,
          name: true,
          primaryCurrency: true,
          timezone: true,
          icon: true,
          color: true,
          isPersonal: true,
          createdAt: true,
          _count: { select: { memberships: true } },
        },
      },
    },
  });

  return memberships.map((m) => toSummary(m.space, m.role));
};

export const getSpace = async (
  spaceId: string,
  role: MembershipRole,
): Promise<SpaceSummary> => {
  const space = await systemClient().space.findFirst({
    where: { id: spaceId, deletedAt: null },
    select: {
      id: true,
      name: true,
      primaryCurrency: true,
      timezone: true,
      icon: true,
      color: true,
      isPersonal: true,
      createdAt: true,
      _count: { select: { memberships: true } },
    },
  });

  if (space === null) throw errors.notFound("No se encontró el espacio");
  return toSummary(space, role);
};

export const createSpace = async (
  userId: string,
  actorName: string,
  input: CreateSpaceRequest,
): Promise<SpaceSummary> => {
  const db = systemClient();

  // Los defaults salen de las preferencias de quien crea, no del entorno:
  // alguien en Madrid que abre un Space para gastos de un viaje a Argentina
  // igual quiere su timezone por defecto y elige la moneda a mano.
  const creator = await db.user.findUnique({
    where: { id: userId },
    select: { timezone: true, locale: true },
  });

  if (creator === null) throw errors.notFound("No se encontró el usuario");

  const space = await db.$transaction(async (tx) => {
    const created = await tx.space.create({
      data: {
        name: input.name,
        primaryCurrency: input.primaryCurrency ?? env.DEFAULT_CURRENCY,
        timezone: input.timezone ?? creator.timezone,
        icon: input.icon ?? null,
        color: input.color ?? null,
        isPersonal: false,
        memberships: { create: { userId, role: "OWNER" } },
      },
      select: {
        id: true,
        name: true,
        primaryCurrency: true,
        timezone: true,
        icon: true,
        color: true,
        isPersonal: true,
        createdAt: true,
      },
    });

    await seedCategories(tx, created.id, creator.locale);

    await writeAuditLog(tx, {
      spaceId: created.id,
      actorUserId: userId,
      actorName,
      action: "SPACE_CREATED",
      entityType: "Space",
      entityId: created.id,
      metadata: { name: created.name },
    });

    return created;
  });

  return toSummary({ ...space, _count: { memberships: 1 } }, "OWNER");
};

export const updateSpace = async (
  spaceId: string,
  userId: string,
  actorName: string,
  role: MembershipRole,
  input: UpdateSpaceRequest,
): Promise<SpaceSummary> => {
  const db = systemClient();

  const updated = await db.$transaction(async (tx) => {
    const space = await tx.space.update({
      where: { id: spaceId },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.icon !== undefined ? { icon: input.icon } : {}),
        ...(input.color !== undefined ? { color: input.color } : {}),
        ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
      },
      select: {
        id: true,
        name: true,
        primaryCurrency: true,
        timezone: true,
        icon: true,
        color: true,
        isPersonal: true,
        createdAt: true,
        _count: { select: { memberships: true } },
      },
    });

    await writeAuditLog(tx, {
      spaceId,
      actorUserId: userId,
      actorName,
      action: "SPACE_UPDATED",
      entityType: "Space",
      entityId: spaceId,
      metadata: { fields: Object.keys(input) },
    });

    return space;
  });

  return toSummary(updated, role);
};

/**
 * Borra un Space (lógicamente).
 *
 * No se puede borrar el último Space de una persona: quedaría con la sesión
 * abierta y sin ningún lugar donde cargar nada. Tampoco el Space personal
 * mientras sea el único.
 */
export const deleteSpace = async (
  spaceId: string,
  userId: string,
  actorName: string,
): Promise<void> => {
  const db = systemClient();

  const remaining = await db.membership.count({
    where: { userId, space: { deletedAt: null }, spaceId: { not: spaceId } },
  });

  if (remaining === 0) {
    throw errors.conflict(
      "CONFLICT",
      "No podés eliminar tu único espacio. Creá otro primero",
    );
  }

  await db.$transaction(async (tx) => {
    await tx.space.update({
      where: { id: spaceId },
      data: { deletedAt: new Date() },
    });

    // Quien tuviera este Space como activo pasa a no tener ninguno; la app
    // elige otro en el próximo arranque.
    await tx.user.updateMany({
      where: { activeSpaceId: spaceId },
      data: { activeSpaceId: null },
    });

    await writeAuditLog(tx, {
      spaceId,
      actorUserId: userId,
      actorName,
      action: "SPACE_DELETED",
      entityType: "Space",
      entityId: spaceId,
    });
  });
};
