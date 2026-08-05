import { errors } from "@/server/api/errors";
import { DUMMY_PASSWORD_HASH, verifyPassword } from "@/server/auth/password";
import { systemClient } from "@/server/db/system";
import { normalizeEmail } from "@/shared/email";
import type { LoginRequest } from "@/shared/contracts/auth";

import { issueSession, type IssuedSession } from "./sessions";

/**
 * Login.
 *
 * Dos cosas que no son obvias y son deliberadas:
 *
 * 1. **Tiempo constante.** Si el email no existe, igual se corre argon2 contra
 *    un hash de descarte. Sin eso, un email inexistente responde en ~1 ms y uno
 *    real en ~50 ms, y esa diferencia permite enumerar qué cuentas existen.
 *
 * 2. **Bloqueo por cuenta en la base.** El rate limit por IP vive en memoria y
 *    se pierde en cada redeploy; un ataque de fuerza bruta contra UNA cuenta
 *    dura horas. `failedLoginCount` y `lockedUntil` van en la tabla User
 *    justamente para sobrevivir a eso.
 */

const MAX_FAILED_ATTEMPTS = 8;
const LOCK_MINUTES = 15;

interface LoginContext {
  readonly userAgent?: string | undefined;
  readonly ip?: string | undefined;
}

export interface LoginResult {
  readonly session: IssuedSession;
  readonly userId: string;
}

export const login = async (
  input: LoginRequest,
  context: LoginContext,
): Promise<LoginResult> => {
  const db = systemClient();

  // Igual que en `register`: el service no asume que quien lo llama haya
  // normalizado. Sin esto, "Ana@x.com" no encontraría la cuenta de "ana@x.com".
  const email = normalizeEmail(input.email);

  const user = await db.user.findUnique({
    where: { email },
    select: {
      id: true,
      passwordHash: true,
      deletedAt: true,
      failedLoginCount: true,
      lockedUntil: true,
    },
  });

  const now = new Date();
  const locked =
    user?.lockedUntil !== null &&
    user?.lockedUntil !== undefined &&
    user.lockedUntil > now;

  if (locked) throw errors.accountLocked();

  const isActive = user !== null && user.deletedAt === null;
  const matches = await verifyPassword(
    isActive ? user.passwordHash : DUMMY_PASSWORD_HASH,
    input.password,
  );

  if (!isActive || !matches) {
    if (user !== null && user.deletedAt === null) {
      await registerFailedAttempt(user.id, user.failedLoginCount);
    }
    // Mismo mensaje para "no existe" y "contraseña incorrecta".
    throw errors.invalidCredentials();
  }

  if (user.failedLoginCount > 0 || user.lockedUntil !== null) {
    await db.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: null },
    });
  }

  const session = await issueSession({
    userId: user.id,
    deviceLabel: input.deviceLabel,
    userAgent: context.userAgent,
    ip: context.ip,
  });

  return { session, userId: user.id };
};

const registerFailedAttempt = async (
  userId: string,
  currentCount: number,
): Promise<void> => {
  const next = currentCount + 1;
  const shouldLock = next >= MAX_FAILED_ATTEMPTS;

  await systemClient().user.update({
    where: { id: userId },
    data: {
      failedLoginCount: shouldLock ? 0 : next,
      lockedUntil: shouldLock
        ? new Date(Date.now() + LOCK_MINUTES * 60_000)
        : null,
    },
  });
};

export const LOGIN_POLICY = {
  maxFailedAttempts: MAX_FAILED_ATTEMPTS,
  lockMinutes: LOCK_MINUTES,
} as const;
