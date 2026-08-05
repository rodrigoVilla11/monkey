/**
 * Roles dentro de un Space.
 *
 * Módulo puro: lo usa el servidor para autorizar y el cliente para decidir qué
 * botones mostrar. Ojo — que el cliente lo use es SOLO cosmético: el permiso
 * real se chequea en el servidor en cada endpoint, sin excepción.
 */

export const MEMBERSHIP_ROLES = ["OWNER", "ADMIN", "MEMBER", "VIEWER"] as const;

export type MembershipRole = (typeof MEMBERSHIP_ROLES)[number];

/**
 * Jerarquía. Número más alto = más permisos.
 *
 * Los saltos son de 10 para poder meter un rol intermedio más adelante sin
 * renumerar todo.
 */
const RANK: Readonly<Record<MembershipRole, number>> = {
  VIEWER: 10,
  MEMBER: 20,
  ADMIN: 30,
  OWNER: 40,
};

export const roleRank = (role: MembershipRole): number => RANK[role];

/** ¿Alcanza este rol para lo que pide `minRole`? */
export const hasAtLeast = (
  role: MembershipRole,
  minRole: MembershipRole,
): boolean => RANK[role] >= RANK[minRole];

export const isRole = (value: string): value is MembershipRole =>
  (MEMBERSHIP_ROLES as readonly string[]).includes(value);

/**
 * Roles que se pueden asignar al invitar o al cambiar el rol de alguien.
 *
 * OWNER no está: un Space tiene exactamente un OWNER (hay un índice único
 * parcial en la base que lo garantiza), así que la propiedad se mueve con
 * `transfer-ownership`, no asignando el rol.
 */
export const ASSIGNABLE_ROLES = ["ADMIN", "MEMBER", "VIEWER"] as const;
export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

export const isAssignableRole = (value: string): value is AssignableRole =>
  (ASSIGNABLE_ROLES as readonly string[]).includes(value);

/** Nombres para la UI. */
export const ROLE_LABELS: Readonly<Record<MembershipRole, string>> = {
  OWNER: "Propietario",
  ADMIN: "Administrador",
  MEMBER: "Miembro",
  VIEWER: "Solo lectura",
};

export const ROLE_DESCRIPTIONS: Readonly<Record<MembershipRole, string>> = {
  OWNER:
    "Control total, incluido eliminar el espacio y transferir la propiedad",
  ADMIN: "Gestiona miembros y datos, pero no puede eliminar el espacio",
  MEMBER: "Carga y edita cuentas, categorías y movimientos",
  VIEWER: "Solo puede consultar; no modifica nada",
};

/**
 * ¿Puede `actor` gestionar la membresía de `target`?
 *
 * Reglas:
 *  · hay que ser al menos ADMIN
 *  · nadie puede tocar al OWNER (ni siquiera otro ADMIN)
 *  · un ADMIN no puede tocar a otro ADMIN — solo el OWNER puede
 *
 * La última evita que dos administradores se expulsen entre sí.
 */
export const canManageMember = (
  actor: MembershipRole,
  target: MembershipRole,
): boolean => {
  if (!hasAtLeast(actor, "ADMIN")) return false;
  if (target === "OWNER") return false;
  if (actor === "OWNER") return true;
  return roleRank(target) < roleRank(actor);
};
