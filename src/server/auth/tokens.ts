import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { jwtVerify, SignJWT } from "jose";

import { env } from "@/env";

/**
 * Tokens.
 *
 * Hay dos clases y conviene no mezclarlas:
 *
 *  · **Access token** — JWT firmado, corto (15 min por defecto). No se guarda
 *    en ningún lado: se verifica por firma. Lo llevan la cookie de la web y el
 *    header `Authorization: Bearer` de los clientes nativos.
 *
 *  · **Tokens opacos** — refresh, verificación de email, reset de password e
 *    invitaciones. Son bytes aleatorios. En la base se guarda SOLO su sha256:
 *    si alguien se lleva un dump, no puede usar ninguno.
 *
 * sha256 sin salt es correcto acá y no una omisión: la entrada tiene 256 bits
 * de entropía real, así que no hay diccionario que atacar. El salt y el costo
 * de argon2 son para contraseñas elegidas por personas.
 */

const secret = new TextEncoder().encode(env.AUTH_SECRET);
const ISSUER = "monkey";
const AUDIENCE = "monkey-api";

export interface AccessTokenClaims {
  readonly userId: string;
  /** Familia de refresh tokens: permite revocar una sesión concreta. */
  readonly sessionId: string;
  /** Emisión, en segundos epoch. Se compara con `User.sessionsRevokedAt`. */
  readonly issuedAt: number;
}

export const accessTokenTtlSeconds = (): number =>
  env.ACCESS_TOKEN_TTL_MINUTES * 60;

export const signAccessToken = async (
  userId: string,
  sessionId: string,
): Promise<string> =>
  new SignJWT({ sid: sessionId })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(userId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${String(env.ACCESS_TOKEN_TTL_MINUTES)}m`)
    .sign(secret);

/**
 * Verifica firma, emisor, audiencia y expiración.
 * Devuelve `null` ante cualquier problema: para quien llama, un token
 * manipulado y uno vencido se tratan igual.
 */
export const verifyAccessToken = async (
  token: string,
): Promise<AccessTokenClaims | null> => {
  try {
    const { payload } = await jwtVerify(token, secret, {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ["HS256"],
    });

    const { sub, sid, iat } = payload;

    if (typeof sub !== "string" || typeof sid !== "string") return null;
    if (typeof iat !== "number") return null;

    return { userId: sub, sessionId: sid, issuedAt: iat };
  } catch {
    return null;
  }
};

// ───────────────────────────── tokens opacos ─────────────────────────────────

export interface OpaqueToken {
  /** Se manda una sola vez (mail o respuesta) y no se puede recuperar. */
  readonly plain: string;
  /** Lo único que toca la base. */
  readonly hash: string;
}

export const createOpaqueToken = (): OpaqueToken => {
  const plain = randomBytes(32).toString("base64url");
  return { plain, hash: hashToken(plain) };
};

export const hashToken = (plain: string): string =>
  createHash("sha256").update(plain).digest("hex");

/**
 * Comparación en tiempo constante.
 *
 * En la práctica los tokens se buscan por su hash con un índice único, así que
 * no hay comparación que temporizar. Queda para los casos en que sí hay que
 * comparar dos valores conocidos, y para no dejar la puerta abierta a que
 * alguien use `===` más adelante.
 */
export const safeCompare = (a: string, b: string): boolean => {
  const bufferA = Buffer.from(a, "utf8");
  const bufferB = Buffer.from(b, "utf8");
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
};

// ────────────────────────────── vencimientos ─────────────────────────────────

const addMinutes = (minutes: number, from: Date = new Date()): Date =>
  new Date(from.getTime() + minutes * 60_000);

export const refreshTokenExpiry = (from?: Date): Date =>
  addMinutes(env.REFRESH_TOKEN_TTL_DAYS * 24 * 60, from);

export const emailVerificationExpiry = (from?: Date): Date =>
  addMinutes(env.EMAIL_VERIFICATION_TTL_HOURS * 60, from);

export const passwordResetExpiry = (from?: Date): Date =>
  addMinutes(env.PASSWORD_RESET_TTL_MINUTES, from);

export const invitationExpiry = (from?: Date): Date =>
  addMinutes(env.INVITATION_TTL_DAYS * 24 * 60, from);

/** Hash de una IP, para detectar anomalías sin guardar el dato personal. */
export const hashIp = (ip: string): string =>
  createHash("sha256")
    .update(`${ip}:${env.AUTH_SECRET}`)
    .digest("hex")
    .slice(0, 32);
