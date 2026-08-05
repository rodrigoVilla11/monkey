import { env } from "@/env";

/**
 * Cookies de sesión para el cliente web.
 *
 * Los clientes nativos no usan nada de esto: mandan `Authorization: Bearer` y
 * guardan el refresh token en el llavero del sistema. `resolveSession` acepta
 * las dos formas de manera transparente.
 */

export const ACCESS_COOKIE = "monkey_at";
export const REFRESH_COOKIE = "monkey_rt";

const isProduction = env.NODE_ENV === "production";

interface CookieOptions {
  readonly httpOnly: true;
  readonly secure: boolean;
  readonly sameSite: "lax";
  readonly path: string;
  readonly maxAge: number;
}

/**
 * `sameSite: "lax"` es lo que protege de CSRF: el navegador no manda la cookie
 * en un POST cross-site. Como todas las mutaciones de la API son POST/PATCH/
 * DELETE, no hace falta además un token CSRF.
 *
 * `secure` sale de NODE_ENV y no de APP_URL para que el desarrollo en
 * http://localhost funcione; en producción `src/env.ts` ya obliga a https.
 */
const baseOptions = (maxAge: number, path: string): CookieOptions => ({
  httpOnly: true,
  secure: isProduction,
  sameSite: "lax",
  path,
  maxAge,
});

export const accessCookieOptions = (maxAgeSeconds: number): CookieOptions =>
  baseOptions(maxAgeSeconds, "/");

/**
 * El refresh token se acota a la rama de auth: no se manda en ningún request
 * normal, así que su superficie de exposición es mucho menor.
 */
export const refreshCookieOptions = (): CookieOptions =>
  baseOptions(env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60, "/api/v1/auth");

export const clearedCookieOptions = (path: string): CookieOptions =>
  baseOptions(0, path);

/** Serializa una cookie para `Set-Cookie`. */
export const serializeCookie = (
  name: string,
  value: string,
  options: CookieOptions,
): string => {
  const parts = [
    `${name}=${value}`,
    `Path=${options.path}`,
    `Max-Age=${String(options.maxAge)}`,
    // Lax y no Strict: con Strict, volver desde el enlace de un mail perdería
    // la sesión. Lax igual bloquea los POST cross-site, que es lo que protege
    // de CSRF.
    "SameSite=Lax",
    "HttpOnly",
  ];
  if (options.secure) parts.push("Secure");
  return parts.join("; ");
};
