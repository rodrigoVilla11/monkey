import type { NextRequest, NextResponse } from "next/server";

import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  accessCookieOptions,
  clearedCookieOptions,
  refreshCookieOptions,
  serializeCookie,
} from "@/server/auth/cookies";
import { isNativeClient } from "@/server/auth/session";
import type { IssuedSession } from "@/server/services/auth/sessions";
import type { AuthResponse, SessionUser } from "@/shared/contracts/auth";

import { json } from "./responses";

/**
 * Entrega de tokens según el tipo de cliente. Está en un solo lugar para que
 * no haya endpoints que se olviden de una de las dos formas.
 *
 *  · **Web** — los tokens van en cookies httpOnly y NO aparecen en el body.
 *    JavaScript no puede leerlos, así que un XSS no se los lleva.
 *
 *  · **Nativo** (`X-Client-Type: native`) — van en el body, porque una app
 *    móvil los guarda en el llavero del sistema y no tiene cookie jar
 *    persistente confiable.
 *
 * Al cliente nativo también se le mandan las cookies: no molestan y hacen que
 * un WebView embebido funcione sin trabajo extra.
 */

export const sessionCookies = (session: IssuedSession): string[] => [
  serializeCookie(
    ACCESS_COOKIE,
    session.accessToken,
    accessCookieOptions(session.expiresIn),
  ),
  serializeCookie(REFRESH_COOKIE, session.refreshToken, refreshCookieOptions()),
];

export const clearedSessionCookies = (): string[] => [
  serializeCookie(ACCESS_COOKIE, "", clearedCookieOptions("/")),
  serializeCookie(REFRESH_COOKIE, "", clearedCookieOptions("/api/v1/auth")),
];

export const authResponse = (
  request: NextRequest,
  user: SessionUser,
  session: IssuedSession,
  status = 200,
  extra: Partial<AuthResponse> = {},
): NextResponse => {
  const body: AuthResponse = {
    user,
    ...(isNativeClient(request)
      ? {
          tokens: {
            accessToken: session.accessToken,
            refreshToken: session.refreshToken,
            expiresIn: session.expiresIn,
            tokenType: "Bearer" as const,
          },
        }
      : {}),
    ...extra,
  };

  return json(body, { status, cookies: sessionCookies(session) });
};

/** Refresh token del request: cookie para la web, body para nativo. */
export const extractRefreshToken = (
  request: NextRequest,
  bodyToken: string | undefined,
): string | null =>
  bodyToken ?? request.cookies.get(REFRESH_COOKIE)?.value ?? null;
