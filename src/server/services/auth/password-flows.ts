import { env } from "@/env";
import { errors } from "@/server/api/errors";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import {
  createOpaqueToken,
  emailVerificationExpiry,
  hashToken,
  passwordResetExpiry,
} from "@/server/auth/tokens";
import { systemClient } from "@/server/db/system";
import type { Mailer } from "@/server/mail/mailer";
import {
  passwordChangedTemplate,
  passwordResetTemplate,
  verifyEmailTemplate,
} from "@/server/mail/templates";
import { normalizeEmail } from "@/shared/email";

import { revokeAllSessions } from "./sessions";

/**
 * Verificación de email, recuperación y cambio de contraseña.
 *
 * Todos los tokens son de un solo uso: se marcan con `usedAt` dentro de la
 * misma transacción que aplica el efecto. Sin eso, dos requests en paralelo
 * con el mismo enlace podrían consumirlo dos veces.
 */

interface Deps {
  readonly mailer: Mailer;
}

// ────────────────────────── verificación de email ────────────────────────────

export const verifyEmail = async (plainToken: string): Promise<void> => {
  const db = systemClient();

  const token = await db.verificationToken.findUnique({
    where: { tokenHash: hashToken(plainToken) },
    include: { user: { select: { id: true, deletedAt: true } } },
  });

  if (
    token?.type !== "EMAIL_VERIFICATION" ||
    token.usedAt !== null ||
    token.user.deletedAt !== null
  ) {
    throw errors.tokenInvalid();
  }

  if (token.expiresAt.getTime() <= Date.now()) {
    throw errors.tokenExpired(
      "El enlace de verificación venció. Pedí uno nuevo",
    );
  }

  await db.$transaction([
    db.user.update({
      where: { id: token.userId },
      data: { emailVerifiedAt: new Date() },
    }),
    db.verificationToken.update({
      where: { id: token.id },
      data: { usedAt: new Date() },
    }),
  ]);
};

export const resendVerification = async (
  userId: string,
  deps: Deps,
): Promise<void> => {
  const db = systemClient();

  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true, emailVerifiedAt: true },
  });

  if (user === null) throw errors.notFound("No se encontró el usuario");
  // Ya verificado: se responde OK sin mandar nada. No es un error.
  if (user.emailVerifiedAt !== null) return;

  const token = createOpaqueToken();

  await db.$transaction([
    // Los enlaces anteriores dejan de servir: siempre hay como mucho uno vivo.
    db.verificationToken.updateMany({
      where: { userId, type: "EMAIL_VERIFICATION", usedAt: null },
      data: { usedAt: new Date() },
    }),
    db.verificationToken.create({
      data: {
        userId,
        tokenHash: token.hash,
        type: "EMAIL_VERIFICATION",
        expiresAt: emailVerificationExpiry(),
      },
    }),
  ]);

  await deps.mailer.send({
    to: user.email,
    ...verifyEmailTemplate(
      user.name,
      `${env.APP_URL}/verify-email?token=${token.plain}`,
      env.EMAIL_VERIFICATION_TTL_HOURS,
    ),
  });
};

// ───────────────────────── recuperación de contraseña ────────────────────────

/**
 * Pedido de recuperación.
 *
 * NUNCA revela si el email existe: siempre termina bien. Quien no tiene cuenta
 * simplemente no recibe nada. Por eso esta función no devuelve nada y no tira
 * ante un email desconocido.
 */
export const requestPasswordReset = async (
  rawEmail: string,
  deps: Deps,
): Promise<void> => {
  const db = systemClient();
  const email = normalizeEmail(rawEmail);

  const user = await db.user.findUnique({
    where: { email },
    select: { id: true, email: true, name: true, deletedAt: true },
  });

  // Cuenta inexistente o borrada: se sale en silencio, sin mandar nada y sin
  // fallar. Distinguir los casos convertiría esto en un verificador de cuentas.
  if (user?.deletedAt !== null) return;

  const token = createOpaqueToken();

  await db.$transaction([
    db.verificationToken.updateMany({
      where: { userId: user.id, type: "PASSWORD_RESET", usedAt: null },
      data: { usedAt: new Date() },
    }),
    db.verificationToken.create({
      data: {
        userId: user.id,
        tokenHash: token.hash,
        type: "PASSWORD_RESET",
        expiresAt: passwordResetExpiry(),
      },
    }),
  ]);

  await deps.mailer.send({
    to: user.email,
    ...passwordResetTemplate(
      user.name,
      `${env.APP_URL}/reset-password?token=${token.plain}`,
      env.PASSWORD_RESET_TTL_MINUTES,
    ),
  });
};

/**
 * Completa la recuperación.
 *
 * Al terminar cierra TODAS las sesiones activas: si alguien había entrado con
 * la contraseña vieja, se queda afuera en el acto. Es lo que pide el brief y
 * es lo correcto — quien restablece la contraseña suele hacerlo justamente
 * porque sospecha que alguien más entró.
 */
export const resetPassword = async (
  plainToken: string,
  newPassword: string,
  deps: Deps,
): Promise<void> => {
  const db = systemClient();

  const token = await db.verificationToken.findUnique({
    where: { tokenHash: hashToken(plainToken) },
    include: {
      user: { select: { id: true, email: true, name: true, deletedAt: true } },
    },
  });

  if (
    token?.type !== "PASSWORD_RESET" ||
    token.usedAt !== null ||
    token.user.deletedAt !== null
  ) {
    throw errors.tokenInvalid();
  }

  if (token.expiresAt.getTime() <= Date.now()) {
    throw errors.tokenExpired("El enlace venció. Pedí uno nuevo");
  }

  const passwordHash = await hashPassword(newPassword);

  await db.$transaction([
    db.user.update({
      where: { id: token.userId },
      data: {
        passwordHash,
        failedLoginCount: 0,
        lockedUntil: null,
        // Quien pudo abrir el mail, controla la casilla: se aprovecha para
        // dar por verificada la dirección.
        emailVerifiedAt: new Date(),
      },
    }),
    db.verificationToken.update({
      where: { id: token.id },
      data: { usedAt: new Date() },
    }),
  ]);

  await revokeAllSessions(token.userId, "reset de contraseña");

  await deps.mailer.send({
    to: token.user.email,
    ...passwordChangedTemplate(token.user.name),
  });
};

// ──────────────────────── cambio desde el perfil ─────────────────────────────

export const changePassword = async (
  userId: string,
  currentPassword: string,
  newPassword: string,
  deps: Deps,
): Promise<void> => {
  const db = systemClient();

  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true, passwordHash: true },
  });

  if (user === null) throw errors.notFound("No se encontró el usuario");

  const matches = await verifyPassword(user.passwordHash, currentPassword);
  if (!matches) {
    throw errors.conflict(
      "INVALID_CREDENTIALS",
      "La contraseña actual no es correcta",
    );
  }

  await db.user.update({
    where: { id: userId },
    data: { passwordHash: await hashPassword(newPassword) },
  });

  await revokeAllSessions(userId, "cambio de contraseña");

  await deps.mailer.send({
    to: user.email,
    ...passwordChangedTemplate(user.name),
  });
};
