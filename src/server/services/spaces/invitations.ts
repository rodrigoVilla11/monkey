import { env } from "@/env";
import { errors } from "@/server/api/errors";
import {
  createOpaqueToken,
  hashToken,
  invitationExpiry,
} from "@/server/auth/tokens";
import { systemClient } from "@/server/db/system";
import type { Mailer } from "@/server/mail/mailer";
import { invitationTemplate } from "@/server/mail/templates";
import { writeAuditLog } from "@/server/services/audit/log";
import type {
  CreateInvitationRequest,
  InvitationPreview,
  PendingInvitation,
} from "@/shared/contracts/spaces";
import { normalizeEmail } from "@/shared/email";
import type { AssignableRole, MembershipRole } from "@/shared/roles";

/**
 * Invitaciones a un Space.
 *
 * Como el resto de los tokens del proyecto: opaco, guardado hasheado, de un
 * solo uso, con vencimiento (7 días por defecto).
 *
 * Un índice único PARCIAL en la base garantiza una sola invitación pendiente
 * por (spaceId, email): sin él, invitar dos veces a la misma persona dejaría
 * dos enlaces vivos y aceptar uno no invalidaría el otro.
 */

interface Deps {
  readonly mailer: Mailer;
}

interface ActorContext {
  readonly userId: string;
  readonly name: string;
  readonly role: MembershipRole;
}

export const listInvitations = async (
  spaceId: string,
): Promise<PendingInvitation[]> => {
  const rows = await systemClient().invitation.findMany({
    where: { spaceId, acceptedAt: null, revokedAt: null },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      email: true,
      role: true,
      expiresAt: true,
      createdAt: true,
      invitedBy: { select: { name: true } },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    email: row.email,
    role: row.role,
    expiresAt: row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    invitedByName: row.invitedBy?.name ?? null,
  }));
};

export const createInvitation = async (
  spaceId: string,
  actor: ActorContext,
  input: CreateInvitationRequest,
  deps: Deps,
): Promise<PendingInvitation> => {
  const db = systemClient();
  const email = normalizeEmail(input.email);

  const space = await db.space.findFirst({
    where: { id: spaceId, deletedAt: null },
    select: { name: true },
  });
  if (space === null) throw errors.notFound("No se encontró el espacio");

  // ¿Ya es miembro? Se responde con un error claro en vez de mandar un mail
  // que no serviría para nada.
  const existingMember = await db.membership.findFirst({
    where: { spaceId, user: { email } },
    select: { id: true },
  });
  if (existingMember !== null) {
    throw errors.conflict(
      "ALREADY_MEMBER",
      "Esa persona ya es miembro del espacio",
    );
  }

  const token = createOpaqueToken();

  const invitation = await db.$transaction(async (tx) => {
    // Se revoca cualquier invitación pendiente previa: el índice único parcial
    // rechazaría la nueva, y además queremos que el enlace viejo deje de valer.
    await tx.invitation.updateMany({
      where: { spaceId, email, acceptedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    const created = await tx.invitation.create({
      data: {
        spaceId,
        email,
        role: input.role,
        tokenHash: token.hash,
        expiresAt: invitationExpiry(),
        invitedByUserId: actor.userId,
      },
      select: {
        id: true,
        email: true,
        role: true,
        expiresAt: true,
        createdAt: true,
      },
    });

    await writeAuditLog(tx, {
      spaceId,
      actorUserId: actor.userId,
      actorName: actor.name,
      action: "MEMBER_INVITED",
      entityType: "Invitation",
      entityId: created.id,
      // El email va porque es el objeto de la acción, no un dato colateral.
      metadata: { email, role: input.role },
    });

    return created;
  });

  await deps.mailer.send({
    to: email,
    ...invitationTemplate(
      actor.name,
      space.name,
      input.role,
      `${env.APP_URL}/invite/${token.plain}`,
      env.INVITATION_TTL_DAYS,
    ),
  });

  return {
    id: invitation.id,
    email: invitation.email,
    role: invitation.role,
    expiresAt: invitation.expiresAt.toISOString(),
    createdAt: invitation.createdAt.toISOString(),
    invitedByName: actor.name,
  };
};

export const revokeInvitation = async (
  spaceId: string,
  actor: ActorContext,
  invitationId: string,
): Promise<void> => {
  const db = systemClient();

  const invitation = await db.invitation.findFirst({
    // El spaceId en el where es lo que impide revocar una invitación de otro
    // Space mandando un id ajeno.
    where: { id: invitationId, spaceId, acceptedAt: null, revokedAt: null },
    select: { id: true, email: true },
  });

  if (invitation === null) {
    throw errors.notFound("No se encontró la invitación");
  }

  await db.$transaction(async (tx) => {
    await tx.invitation.update({
      where: { id: invitation.id },
      data: { revokedAt: new Date() },
    });

    await writeAuditLog(tx, {
      spaceId,
      actorUserId: actor.userId,
      actorName: actor.name,
      action: "INVITATION_REVOKED",
      entityType: "Invitation",
      entityId: invitation.id,
      metadata: { email: invitation.email },
    });
  });
};

/**
 * Vista previa SIN sesión, para la pantalla del enlace.
 *
 * Devuelve lo mínimo indispensable: nombre del Space, rol ofrecido y quién
 * invita. Nada de miembros, cuentas ni saldos — quien tiene el enlace todavía
 * no es miembro de nada.
 */
export const previewInvitation = async (
  plainToken: string,
): Promise<InvitationPreview> => {
  const invitation = await systemClient().invitation.findUnique({
    where: { tokenHash: hashToken(plainToken) },
    select: {
      email: true,
      role: true,
      expiresAt: true,
      acceptedAt: true,
      revokedAt: true,
      space: { select: { name: true, deletedAt: true } },
      invitedBy: { select: { name: true } },
    },
  });

  // El optional chaining cubre también "no existe": `undefined !== null` es
  // true, así que un token inventado cae en la misma respuesta que uno usado.
  if (
    invitation?.acceptedAt !== null ||
    invitation.revokedAt !== null ||
    invitation.space.deletedAt !== null
  ) {
    throw errors.tokenInvalid("La invitación no es válida o ya se usó");
  }

  if (invitation.expiresAt.getTime() <= Date.now()) {
    throw errors.tokenExpired("La invitación venció. Pedí una nueva");
  }

  return {
    spaceName: invitation.space.name,
    role: invitation.role,
    invitedByName: invitation.invitedBy?.name ?? null,
    email: invitation.email,
    expiresAt: invitation.expiresAt.toISOString(),
  };
};

export interface AcceptResult {
  readonly spaceId: string;
  readonly spaceName: string;
  readonly role: AssignableRole;
}

/**
 * Aceptar una invitación.
 *
 * Exige que el email de la sesión coincida con el de la invitación. Sin eso,
 * cualquiera con el enlace entraría al Space — y los enlaces viajan por mail,
 * se reenvían y quedan en historiales.
 */
export const acceptInvitation = async (
  plainToken: string,
  user: { readonly id: string; readonly email: string; readonly name: string },
): Promise<AcceptResult> => {
  const db = systemClient();

  const invitation = await db.invitation.findUnique({
    where: { tokenHash: hashToken(plainToken) },
    select: {
      id: true,
      spaceId: true,
      email: true,
      role: true,
      expiresAt: true,
      acceptedAt: true,
      revokedAt: true,
      invitedByUserId: true,
      space: { select: { name: true, deletedAt: true } },
    },
  });

  // El optional chaining cubre también "no existe": `undefined !== null` es
  // true, así que un token inventado cae en la misma respuesta que uno usado.
  if (
    invitation?.acceptedAt !== null ||
    invitation.revokedAt !== null ||
    invitation.space.deletedAt !== null
  ) {
    throw errors.tokenInvalid("La invitación no es válida o ya se usó");
  }

  if (invitation.expiresAt.getTime() <= Date.now()) {
    throw errors.tokenExpired("La invitación venció. Pedí una nueva");
  }

  if (invitation.email !== normalizeEmail(user.email)) {
    throw errors.forbidden("Esta invitación es para otra dirección de email");
  }

  const existing = await db.membership.findUnique({
    where: { userId_spaceId: { userId: user.id, spaceId: invitation.spaceId } },
    select: { id: true },
  });

  if (existing !== null) {
    // Ya era miembro (por ejemplo, lo invitaron dos veces): se consume el token
    // y se responde bien. Fallar acá sería confuso y no aporta nada.
    await db.invitation.update({
      where: { id: invitation.id },
      data: { acceptedAt: new Date(), acceptedByUserId: user.id },
    });

    throw errors.conflict("ALREADY_MEMBER", "Ya sos miembro de este espacio");
  }

  const role = invitation.role;

  await db.$transaction(async (tx) => {
    await tx.membership.create({
      data: {
        userId: user.id,
        spaceId: invitation.spaceId,
        role,
        invitedByUserId: invitation.invitedByUserId,
      },
    });

    await tx.invitation.update({
      where: { id: invitation.id },
      data: { acceptedAt: new Date(), acceptedByUserId: user.id },
    });

    // Al aceptar, el Space nuevo pasa a ser el activo: es lo que la persona
    // acaba de pedir ver.
    await tx.user.update({
      where: { id: user.id },
      data: { activeSpaceId: invitation.spaceId },
    });

    await writeAuditLog(tx, {
      spaceId: invitation.spaceId,
      actorUserId: user.id,
      actorName: user.name,
      action: "INVITATION_ACCEPTED",
      entityType: "Invitation",
      entityId: invitation.id,
      metadata: { role },
    });
  });

  return {
    spaceId: invitation.spaceId,
    spaceName: invitation.space.name,
    role: role as AssignableRole,
  };
};
