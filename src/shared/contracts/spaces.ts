import { z } from "zod";

import { isCurrencyCode } from "../currency";
import { isValidTimeZone } from "../dates";
import { normalizeEmail } from "../email";
import { ASSIGNABLE_ROLES, type MembershipRole } from "../roles";

/**
 * Contratos de Spaces, membresías e invitaciones.
 *
 * Módulo puro, sin dependencias de Next ni de Prisma: un cliente Expo lo
 * importa tal cual.
 */

const nameSchema = z.string().trim().min(1, "El nombre es obligatorio").max(60);
const colorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "Color hexadecimal inválido");

export const assignableRoleSchema = z.enum(ASSIGNABLE_ROLES);

// ─────────────────────────────── Spaces ──────────────────────────────────────

export const createSpaceRequestSchema = z.object({
  name: nameSchema,
  primaryCurrency: z
    .string()
    .refine(isCurrencyCode, "Código de moneda ISO 4217 inválido")
    .optional(),
  timezone: z
    .string()
    .refine(isValidTimeZone, "Timezone IANA inválida")
    .optional(),
  icon: z.string().max(40).optional(),
  color: colorSchema.optional(),
});

export const updateSpaceRequestSchema = z
  .object({
    name: nameSchema.optional(),
    icon: z.string().max(40).nullable().optional(),
    color: colorSchema.nullable().optional(),
    timezone: z
      .string()
      .refine(isValidTimeZone, "Timezone IANA inválida")
      .optional(),
    /**
     * `primaryCurrency` NO se puede cambiar. Todas las transacciones guardan su
     * conversión congelada a la moneda primaria del momento; cambiarla dejaría
     * los importes históricos convertidos contra una moneda que ya no es.
     * Migrar un Space de moneda es una operación con recálculo, no un PATCH.
     */
  })
  .refine(
    (value) => Object.keys(value).length > 0,
    "Hay que mandar al menos un campo",
  );

export type CreateSpaceRequest = z.infer<typeof createSpaceRequestSchema>;
export type UpdateSpaceRequest = z.infer<typeof updateSpaceRequestSchema>;

// ────────────────────────────── membresías ───────────────────────────────────

export const updateMemberRequestSchema = z.object({
  role: assignableRoleSchema,
});

export const transferOwnershipRequestSchema = z.object({
  /** Miembro que pasa a ser OWNER. Quien transfiere queda como ADMIN. */
  userId: z.string().min(1),
});

export type UpdateMemberRequest = z.infer<typeof updateMemberRequestSchema>;
export type TransferOwnershipRequest = z.infer<
  typeof transferOwnershipRequestSchema
>;

// ───────────────────────────── invitaciones ──────────────────────────────────

export const createInvitationRequestSchema = z.object({
  email: z
    .string()
    .trim()
    .min(3)
    .max(254)
    .transform(normalizeEmail)
    .pipe(z.email("Email inválido")),
  role: assignableRoleSchema,
});

export type CreateInvitationRequest = z.infer<
  typeof createInvitationRequestSchema
>;

// ────────────────────────────── respuestas ───────────────────────────────────

export interface SpaceSummary {
  readonly id: string;
  readonly name: string;
  readonly primaryCurrency: string;
  readonly timezone: string;
  readonly icon: string | null;
  readonly color: string | null;
  readonly isPersonal: boolean;
  /** Rol de quien pregunta dentro de este Space. */
  readonly role: MembershipRole;
  readonly memberCount: number;
  readonly createdAt: string;
}

export interface SpaceMember {
  readonly userId: string;
  readonly name: string;
  readonly email: string;
  readonly avatarUrl: string | null;
  readonly role: MembershipRole;
  readonly joinedAt: string;
  /** Quien pregunta. La UI lo usa para no ofrecer "expulsarme a mí mismo". */
  readonly isSelf: boolean;
}

export interface PendingInvitation {
  readonly id: string;
  readonly email: string;
  readonly role: MembershipRole;
  readonly expiresAt: string;
  readonly createdAt: string;
  readonly invitedByName: string | null;
}

/**
 * Vista previa de una invitación, accesible SIN sesión.
 *
 * Devuelve lo mínimo para que la pantalla diga "te invitaron a X como Y":
 * nombre del Space, rol y quién invita. Nada de miembros, saldos ni cuentas —
 * quien tiene el enlace todavía no es miembro de nada.
 */
export interface InvitationPreview {
  readonly spaceName: string;
  readonly role: MembershipRole;
  readonly invitedByName: string | null;
  readonly email: string;
  readonly expiresAt: string;
}

export interface AuditLogEntry {
  readonly id: string;
  readonly action: string;
  readonly entityType: string;
  readonly entityId: string | null;
  readonly actorName: string;
  readonly metadata: unknown;
  readonly createdAt: string;
}
