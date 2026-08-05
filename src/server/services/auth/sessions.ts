import { systemClient } from "@/server/db/system";
import {
  createOpaqueToken,
  hashIp,
  hashToken,
  refreshTokenExpiry,
  signAccessToken,
  accessTokenTtlSeconds,
} from "@/server/auth/tokens";
import { errors } from "@/server/api/errors";
import type { AuthTokens } from "@/shared/contracts/auth";

/**
 * Ciclo de vida de las sesiones: emisión, rotación y revocación de refresh
 * tokens.
 *
 * Modelo elegido (§0.2 del plan, opción A):
 *   · access token JWT de 15 min, sin estado
 *   · refresh token opaco de 60 días, guardado hasheado y ROTATIVO
 *
 * La rotación es lo que hace que un refresh token robado sirva de poco: en
 * cuanto el dueño legítimo lo usa una vez, el robado queda inservible, y el
 * intento de reusarlo delata el robo.
 */

export interface IssuedSession extends AuthTokens {
  readonly sessionId: string;
}

interface IssueOptions {
  readonly userId: string;
  readonly deviceLabel?: string | undefined;
  readonly userAgent?: string | undefined;
  readonly ip?: string | undefined;
}

export const issueSession = async (
  options: IssueOptions,
): Promise<IssuedSession> => {
  const db = systemClient();
  const token = createOpaqueToken();

  const record = await db.refreshToken.create({
    data: {
      userId: options.userId,
      tokenHash: token.hash,
      deviceLabel: options.deviceLabel ?? null,
      userAgent: options.userAgent?.slice(0, 300) ?? null,
      ipHash: options.ip !== undefined ? hashIp(options.ip) : null,
      expiresAt: refreshTokenExpiry(),
    },
  });

  const accessToken = await signAccessToken(options.userId, record.id);

  return {
    sessionId: record.id,
    accessToken,
    refreshToken: token.plain,
    expiresIn: accessTokenTtlSeconds(),
    tokenType: "Bearer",
  };
};

/**
 * Canjea un refresh token por un par nuevo, invalidando el anterior.
 *
 * Detección de reuso: si llega un token que ya fue rotado (tiene
 * `replacedByTokenId`), significa que hay dos partes usando la misma cadena —
 * o sea, una copia robada. En ese caso no se revoca solo ese token: se cierran
 * TODAS las sesiones del usuario, porque no hay forma de saber cuál de las dos
 * partes es la legítima.
 */
export const rotateSession = async (
  plainToken: string,
  context: {
    readonly userAgent?: string | undefined;
    readonly ip?: string | undefined;
  },
): Promise<IssuedSession> => {
  const db = systemClient();
  const tokenHash = hashToken(plainToken);

  const existing = await db.refreshToken.findUnique({
    where: { tokenHash },
    include: {
      user: { select: { id: true, deletedAt: true, sessionsRevokedAt: true } },
    },
  });

  if (existing === null) throw errors.tokenInvalid("Sesión inválida");

  if (existing.replacedByTokenId !== null) {
    await revokeAllSessions(
      existing.userId,
      "reuso de refresh token detectado",
    );
    throw errors.tokenInvalid(
      "Se detectó un uso indebido de la sesión. Volvé a iniciar sesión",
    );
  }

  if (existing.revokedAt !== null) throw errors.tokenInvalid("Sesión cerrada");
  if (existing.expiresAt.getTime() <= Date.now()) {
    throw errors.tokenExpired("La sesión venció. Volvé a iniciar sesión");
  }
  if (existing.user.deletedAt !== null)
    throw errors.tokenInvalid("Sesión inválida");

  const replacement = createOpaqueToken();
  const now = new Date();

  // Rotación atómica: o se crea el nuevo y se marca el viejo, o no pasa nada.
  // Sin transacción, un fallo entre medio dejaría al usuario sin sesión válida.
  const created = await db.$transaction(async (tx) => {
    const next = await tx.refreshToken.create({
      data: {
        userId: existing.userId,
        tokenHash: replacement.hash,
        deviceLabel: existing.deviceLabel,
        userAgent: context.userAgent?.slice(0, 300) ?? existing.userAgent,
        ipHash: context.ip !== undefined ? hashIp(context.ip) : existing.ipHash,
        expiresAt: refreshTokenExpiry(),
      },
    });

    await tx.refreshToken.update({
      where: { id: existing.id },
      data: { revokedAt: now, lastUsedAt: now, replacedByTokenId: next.id },
    });

    return next;
  });

  const accessToken = await signAccessToken(existing.userId, created.id);

  return {
    sessionId: created.id,
    accessToken,
    refreshToken: replacement.plain,
    expiresIn: accessTokenTtlSeconds(),
    tokenType: "Bearer",
  };
};

export const revokeSessionByToken = async (
  plainToken: string,
): Promise<void> => {
  await systemClient().refreshToken.updateMany({
    where: { tokenHash: hashToken(plainToken), revokedAt: null },
    data: { revokedAt: new Date() },
  });
};

export const revokeSessionById = async (
  userId: string,
  sessionId: string,
): Promise<void> => {
  const result = await systemClient().refreshToken.updateMany({
    // El userId en el where es lo que impide cerrar la sesión de otra persona
    // mandando un id ajeno.
    where: { id: sessionId, userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  if (result.count === 0) throw errors.notFound("No se encontró la sesión");
};

/**
 * Cierra todas las sesiones del usuario.
 *
 * Revocar los refresh tokens no alcanza: los access tokens ya emitidos siguen
 * siendo válidos hasta que expiran. Por eso también se marca
 * `sessionsRevokedAt`, que `resolveSession` compara contra el `iat` de cada
 * token en cada request. Con las dos cosas, el cierre es inmediato.
 */
export const revokeAllSessions = async (
  userId: string,
  _reason: string,
): Promise<void> => {
  const db = systemClient();
  const now = new Date();

  await db.$transaction([
    db.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: now },
    }),
    db.user.update({
      where: { id: userId },
      data: { sessionsRevokedAt: now },
    }),
  ]);
};

export const listSessions = async (
  userId: string,
  currentSessionId: string,
) => {
  const rows = await systemClient().refreshToken.findMany({
    where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      deviceLabel: true,
      createdAt: true,
      lastUsedAt: true,
      expiresAt: true,
    },
  });

  return rows.map((row) => ({
    id: row.id,
    deviceLabel: row.deviceLabel,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
    expiresAt: row.expiresAt,
    current: row.id === currentSessionId,
  }));
};
