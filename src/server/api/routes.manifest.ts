import type { MembershipRole } from "@/shared/roles";

/**
 * Inventario declarado de la API v1.
 *
 * Es la fuente única de la que salen tres cosas:
 *
 *  1. `role-matrix.test.ts` — prueba cada endpoint acotado a Space contra cada
 *     rol y verifica el HTTP esperado.
 *  2. `space-isolation.test.ts` — prueba cada endpoint con IDs válidos de OTRO
 *     Space, por path, body y query.
 *  3. `routes-manifest.test.ts` — recorre `app/api/v1/**` y falla si hay un
 *     `route.ts` que no está acá.
 *
 * Ese tercer test es el que importa: sin él, agregar un endpoint y olvidarse de
 * registrarlo lo dejaría fuera de la matriz de permisos y de la prueba de
 * aislamiento sin que nadie se entere. Con él, la suite falla.
 */

export type AuthRequirement =
  /** Sin credenciales. */
  | "public"
  /** Sesión válida; no hace falta email verificado. */
  | "session"
  /** Sesión válida y email verificado. */
  | "verified";

export interface RouteSpec {
  readonly method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  /** Path con parámetros al estilo Next: /api/v1/spaces/[spaceId]. */
  readonly path: string;
  readonly auth: AuthRequirement;
  /**
   * Rol mínimo, si el endpoint está acotado a un Space. Estos son los que
   * recorren la matriz de roles y la prueba de aislamiento.
   */
  readonly minRole?: MembershipRole;
  readonly rateLimited?: boolean;
  readonly note?: string;
}

export const ROUTES: readonly RouteSpec[] = [
  // ── salud ────────────────────────────────────────────────────────────────
  { method: "GET", path: "/api/health", auth: "public" },

  // ── auth ─────────────────────────────────────────────────────────────────
  {
    method: "POST",
    path: "/api/v1/auth/register",
    auth: "public",
    rateLimited: true,
  },
  {
    method: "POST",
    path: "/api/v1/auth/login",
    auth: "public",
    rateLimited: true,
  },
  {
    method: "POST",
    path: "/api/v1/auth/refresh",
    auth: "public",
    rateLimited: true,
    note: "La credencial es el refresh token, no el access token",
  },
  {
    method: "POST",
    path: "/api/v1/auth/logout",
    auth: "public",
    note: "Sin auth a propósito: cerrar sesión con un token vencido tiene que funcionar",
  },
  { method: "POST", path: "/api/v1/auth/verify-email", auth: "public" },
  {
    method: "POST",
    path: "/api/v1/auth/verify-email/resend",
    auth: "session",
    rateLimited: true,
    note: "Único endpoint que una cuenta sin verificar necesita llamar",
  },
  {
    method: "POST",
    path: "/api/v1/auth/password/forgot",
    auth: "public",
    rateLimited: true,
    note: "Siempre 204: nunca revela si el email existe",
  },
  { method: "POST", path: "/api/v1/auth/password/reset", auth: "public" },
  { method: "POST", path: "/api/v1/auth/password/change", auth: "verified" },
  { method: "GET", path: "/api/v1/auth/sessions", auth: "session" },
  { method: "DELETE", path: "/api/v1/auth/sessions/[id]", auth: "session" },
  {
    method: "POST",
    path: "/api/v1/auth/sessions/revoke-all",
    auth: "session",
  },

  // ── perfil ───────────────────────────────────────────────────────────────
  { method: "GET", path: "/api/v1/me", auth: "session" },
  { method: "PATCH", path: "/api/v1/me", auth: "verified" },
  { method: "PUT", path: "/api/v1/me/active-space", auth: "verified" },

  // ── spaces ───────────────────────────────────────────────────────────────
  { method: "GET", path: "/api/v1/spaces", auth: "verified" },
  { method: "POST", path: "/api/v1/spaces", auth: "verified" },
  {
    method: "GET",
    path: "/api/v1/spaces/[spaceId]",
    auth: "verified",
    minRole: "VIEWER",
  },
  {
    method: "PATCH",
    path: "/api/v1/spaces/[spaceId]",
    auth: "verified",
    minRole: "ADMIN",
  },
  {
    method: "DELETE",
    path: "/api/v1/spaces/[spaceId]",
    auth: "verified",
    minRole: "OWNER",
  },
  {
    method: "POST",
    path: "/api/v1/spaces/[spaceId]/transfer-ownership",
    auth: "verified",
    minRole: "OWNER",
  },

  // ── miembros ─────────────────────────────────────────────────────────────
  {
    method: "GET",
    path: "/api/v1/spaces/[spaceId]/members",
    auth: "verified",
    minRole: "VIEWER",
    note: "VIEWER incluido: cada transacción muestra el avatar de quien la cargó",
  },
  {
    method: "PATCH",
    path: "/api/v1/spaces/[spaceId]/members/[userId]",
    auth: "verified",
    minRole: "ADMIN",
  },
  {
    method: "DELETE",
    path: "/api/v1/spaces/[spaceId]/members/[userId]",
    auth: "verified",
    minRole: "ADMIN",
  },
  {
    method: "POST",
    path: "/api/v1/spaces/[spaceId]/members/leave",
    auth: "verified",
    minRole: "VIEWER",
    note: "Cualquiera puede irse; el OWNER tiene que transferir primero",
  },

  // ── invitaciones ─────────────────────────────────────────────────────────
  {
    method: "GET",
    path: "/api/v1/spaces/[spaceId]/invitations",
    auth: "verified",
    minRole: "ADMIN",
  },
  {
    method: "POST",
    path: "/api/v1/spaces/[spaceId]/invitations",
    auth: "verified",
    minRole: "ADMIN",
  },
  {
    method: "DELETE",
    path: "/api/v1/spaces/[spaceId]/invitations/[invitationId]",
    auth: "verified",
    minRole: "ADMIN",
  },
  {
    method: "GET",
    path: "/api/v1/invitations/[token]",
    auth: "public",
    note: "Vista previa sin sesión: quien recibe el enlace puede no tener cuenta",
  },
  {
    method: "POST",
    path: "/api/v1/invitations/[token]/accept",
    auth: "verified",
  },

  // ── auditoría ────────────────────────────────────────────────────────────
  {
    method: "GET",
    path: "/api/v1/spaces/[spaceId]/audit-logs",
    auth: "verified",
    minRole: "ADMIN",
  },

  // ── cuentas ──────────────────────────────────────────────────────────────
  {
    method: "GET",
    path: "/api/v1/spaces/[spaceId]/accounts",
    auth: "verified",
    minRole: "VIEWER",
  },
  {
    method: "POST",
    path: "/api/v1/spaces/[spaceId]/accounts",
    auth: "verified",
    minRole: "MEMBER",
  },
  {
    method: "GET",
    path: "/api/v1/spaces/[spaceId]/accounts/[accountId]",
    auth: "verified",
    minRole: "VIEWER",
  },
  {
    method: "PATCH",
    path: "/api/v1/spaces/[spaceId]/accounts/[accountId]",
    auth: "verified",
    minRole: "MEMBER",
  },
  {
    method: "DELETE",
    path: "/api/v1/spaces/[spaceId]/accounts/[accountId]",
    auth: "verified",
    minRole: "ADMIN",
    note: "Destructivo y auditado. Con movimientos responde 409: hay que archivar",
  },
  {
    method: "POST",
    path: "/api/v1/spaces/[spaceId]/accounts/[accountId]/archive",
    auth: "verified",
    minRole: "MEMBER",
  },

  // ── categorías ───────────────────────────────────────────────────────────
  {
    method: "GET",
    path: "/api/v1/spaces/[spaceId]/categories",
    auth: "verified",
    minRole: "VIEWER",
  },
  {
    method: "POST",
    path: "/api/v1/spaces/[spaceId]/categories",
    auth: "verified",
    minRole: "MEMBER",
  },
  {
    method: "PATCH",
    path: "/api/v1/spaces/[spaceId]/categories/[categoryId]",
    auth: "verified",
    minRole: "MEMBER",
  },
  {
    method: "DELETE",
    path: "/api/v1/spaces/[spaceId]/categories/[categoryId]",
    auth: "verified",
    minRole: "MEMBER",
  },

  // ── transacciones ────────────────────────────────────────────────────────
  {
    method: "GET",
    path: "/api/v1/spaces/[spaceId]/transactions",
    auth: "verified",
    minRole: "VIEWER",
  },
  {
    method: "POST",
    path: "/api/v1/spaces/[spaceId]/transactions",
    auth: "verified",
    minRole: "MEMBER",
  },
  {
    method: "GET",
    path: "/api/v1/spaces/[spaceId]/transactions/[transactionId]",
    auth: "verified",
    minRole: "VIEWER",
  },
  {
    method: "PATCH",
    path: "/api/v1/spaces/[spaceId]/transactions/[transactionId]",
    auth: "verified",
    minRole: "MEMBER",
  },
  {
    method: "DELETE",
    path: "/api/v1/spaces/[spaceId]/transactions/[transactionId]",
    auth: "verified",
    minRole: "MEMBER",
  },
  {
    method: "POST",
    path: "/api/v1/spaces/[spaceId]/transactions/bulk-delete",
    auth: "verified",
    minRole: "ADMIN",
    note: "La operación más destructiva del dominio: ADMIN y auditada",
  },

  // ── etiquetas ────────────────────────────────────────────────────────────
  {
    method: "GET",
    path: "/api/v1/spaces/[spaceId]/tags",
    auth: "verified",
    minRole: "VIEWER",
  },
  {
    method: "POST",
    path: "/api/v1/spaces/[spaceId]/tags",
    auth: "verified",
    minRole: "MEMBER",
  },
  {
    method: "PATCH",
    path: "/api/v1/spaces/[spaceId]/tags/[tagId]",
    auth: "verified",
    minRole: "MEMBER",
  },
  {
    method: "DELETE",
    path: "/api/v1/spaces/[spaceId]/tags/[tagId]",
    auth: "verified",
    minRole: "MEMBER",
  },

  // ── dashboard ────────────────────────────────────────────────────────────
  {
    method: "GET",
    path: "/api/v1/spaces/[spaceId]/dashboard",
    auth: "verified",
    minRole: "VIEWER",
  },
];

/** Endpoints acotados a un Space: los que recorren la matriz de roles. */
export const SPACE_SCOPED_ROUTES = ROUTES.filter(
  (r): r is RouteSpec & { minRole: MembershipRole } => r.minRole !== undefined,
);

export const routeKey = (route: RouteSpec): string =>
  `${route.method} ${route.path}`;
