import type { NextRequest } from "next/server";

import { systemClient } from "@/server/db/system";

import { ACCESS_COOKIE } from "./cookies";
import { verifyAccessToken } from "./tokens";

/**
 * Resolución de sesión. Es el único lugar del proyecto que decide "quién es
 * quien hace este request".
 *
 * Acepta las dos formas de manera transparente:
 *   · `Authorization: Bearer <jwt>` — clientes nativos
 *   · cookie httpOnly `monkey_at`   — cliente web
 *
 * El header gana si vienen los dos, porque es explícito.
 *
 * Ningún handler de la API conoce Auth.js ni el formato del token: todos
 * llaman a esta función. Eso es lo que mantiene la API portable a un cliente
 * Expo.
 *
 * ── Sobre el chequeo contra la base ──────────────────────────────────────
 * Se verifica la firma del JWT (sin base) y además se lee UNA fila de User.
 * Ese lookup por PK da tres cosas que la firma sola no puede dar:
 *
 *   · revocación inmediata — `sessionsRevokedAt` invalida en el acto todos los
 *     tokens emitidos antes (lo usa el reset de password)
 *   · un usuario borrado deja de entrar al instante
 *   · el estado de verificación de email y las preferencias (timezone, locale)
 *     que los endpoints necesitan igual para resolver fechas
 *
 * El plan original difería este chequeo para dejar la sesión 100% stateless,
 * a cambio de una ventana de revocación de hasta 15 minutos. Se cambió: es un
 * lookup por clave primaria que la mayoría de los endpoints iban a hacer de
 * todos modos, y a cambio la revocación es inmediata.
 */

export interface AuthenticatedSession {
  readonly userId: string;
  readonly sessionId: string;
  readonly email: string;
  readonly name: string;
  readonly timezone: string;
  readonly locale: string;
  readonly emailVerified: boolean;
  readonly activeSpaceId: string | null;
}

const bearerToken = (request: NextRequest): string | null => {
  const header = request.headers.get("authorization");
  if (header === null) return null;

  const [scheme, value] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer") return null;
  return value !== undefined && value !== "" ? value : null;
};

export const extractAccessToken = (request: NextRequest): string | null =>
  bearerToken(request) ?? request.cookies.get(ACCESS_COOKIE)?.value ?? null;

export const resolveSession = async (
  request: NextRequest,
): Promise<AuthenticatedSession | null> => {
  const token = extractAccessToken(request);
  if (token === null) return null;

  const claims = await verifyAccessToken(token);
  if (claims === null) return null;

  const user = await systemClient().user.findUnique({
    where: { id: claims.userId },
    select: {
      id: true,
      email: true,
      name: true,
      timezone: true,
      locale: true,
      emailVerifiedAt: true,
      activeSpaceId: true,
      deletedAt: true,
      sessionsRevokedAt: true,
    },
  });

  // Cubre las dos cosas a la vez: usuario inexistente (undefined !== null) y
  // usuario dado de baja. Un token firmado de una cuenta borrada no entra.
  if (user?.deletedAt !== null) return null;

  // Revocación dura: todo token emitido antes de esta marca deja de valer.
  if (user.sessionsRevokedAt !== null) {
    const revokedAtSeconds = Math.floor(
      user.sessionsRevokedAt.getTime() / 1000,
    );
    // `iat` viene en segundos, así que se compara con el mismo redondeo; el
    // `<` (y no `<=`) evita invalidar un token emitido en el mismo segundo en
    // que se revocó, que es el que se acaba de entregar tras el reset.
    if (claims.issuedAt < revokedAtSeconds) return null;
  }

  return {
    userId: user.id,
    sessionId: claims.sessionId,
    email: user.email,
    name: user.name,
    timezone: user.timezone,
    locale: user.locale,
    emailVerified: user.emailVerifiedAt !== null,
    activeSpaceId: user.activeSpaceId,
  };
};

/** Detecta si el cliente quiere los tokens en el body en vez de en cookies. */
export const isNativeClient = (request: NextRequest): boolean =>
  request.headers.get("x-client-type")?.toLowerCase() === "native";
