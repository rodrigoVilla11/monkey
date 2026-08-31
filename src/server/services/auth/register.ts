import { errors } from "@/server/api/errors";
import { hashPassword } from "@/server/auth/password";
import {
  createOpaqueToken,
  emailVerificationExpiry,
} from "@/server/auth/tokens";
import { systemClient } from "@/server/db/system";
import type { Mailer } from "@/server/mail/mailer";
import { verifyEmailTemplate } from "@/server/mail/templates";
import { env } from "@/env";
import { getDefaultCategories } from "@/shared/default-categories";
import { normalizeEmail } from "@/shared/email";
import type { RegisterRequest } from "@/shared/contracts/auth";

/**
 * Registro.
 *
 * Todo pasa dentro de una única transacción: usuario, Space personal,
 * membresía OWNER, catálogo de categorías y token de verificación. Si algo
 * falla, no queda un usuario a medio crear sin Space al que entrar.
 *
 * El mail se manda DESPUÉS de que la transacción confirme. Al revés, un
 * rollback dejaría en el buzón un enlace de verificación de una cuenta que no
 * existe.
 *
 * ── Y si el mail falla, el registro NO falla ────────────────────────────────
 *
 * Esto se aprendió en producción. Antes, un fallo del proveedor de correo hacía
 * reventar la petición entera: la cuenta quedaba creada —la transacción ya
 * había confirmado— pero quien se registraba veía "algo salió mal de nuestro
 * lado", y al reintentar le decían que el email ya estaba en uso. Sin manera de
 * entender qué había pasado ni de seguir adelante.
 *
 * La asimetría manda: la cuenta es lo difícil de deshacer —el email es único—
 * mientras que el mail es reintentable desde `/verify-email/resend`. Así que el
 * registro devuelve 201 igual y avisa que el correo no salió.
 */

interface RegisterDeps {
  readonly mailer: Mailer;
}

export interface RegisterResult {
  readonly userId: string;
  readonly spaceId: string;
  /**
   * `false` si la cuenta se creó pero el mail de verificación no salió. La
   * pantalla lo usa para decir qué pasó y ofrecer reenviarlo, en vez de dar por
   * hecho que el mail está en camino.
   */
  readonly verificationEmailSent: boolean;
}

export const register = async (
  input: RegisterRequest,
  deps: RegisterDeps,
): Promise<RegisterResult> => {
  const db = systemClient();

  /**
   * Se normaliza acá aunque el esquema Zod ya lo haga. Un service no puede
   * asumir quién lo llama: también lo usan `scripts/create-first-user.ts` y
   * los tests. Sin esto, un email con mayúsculas rompe contra el CHECK de la
   * base con un error de Prisma en vez de un 409 entendible.
   */
  const email = normalizeEmail(input.email);

  const existing = await db.user.findUnique({
    where: { email },
    select: { id: true },
  });

  /**
   * Acá SÍ se dice que el email ya existe, a diferencia del flujo de
   * recuperación. Es un compromiso deliberado: sin este mensaje, quien ya
   * tiene cuenta y se olvidó no entiende por qué "no pasa nada" al registrarse.
   * El registro ya está limitado por IP, y la enumeración de cuentas por esta
   * vía es cara y ruidosa.
   */
  if (existing !== null) {
    throw errors.conflict(
      "EMAIL_ALREADY_REGISTERED",
      "Ya existe una cuenta con ese email",
    );
  }

  const passwordHash = await hashPassword(input.password);
  const timezone = input.timezone ?? env.DEFAULT_TIMEZONE;
  const locale = input.locale ?? env.DEFAULT_LOCALE;
  const currency = input.currency ?? env.DEFAULT_CURRENCY;
  const verification = createOpaqueToken();

  const result = await db.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email,
        passwordHash,
        name: input.name,
        timezone,
        locale,
        preferredCurrency: currency,
      },
    });

    const space = await tx.space.create({
      data: {
        name: "Personal",
        primaryCurrency: currency,
        timezone,
        isPersonal: true,
        memberships: { create: { userId: user.id, role: "OWNER" } },
      },
    });

    await seedCategories(tx, space.id, locale);

    await tx.user.update({
      where: { id: user.id },
      data: { activeSpaceId: space.id },
    });

    await tx.verificationToken.create({
      data: {
        userId: user.id,
        tokenHash: verification.hash,
        type: "EMAIL_VERIFICATION",
        expiresAt: emailVerificationExpiry(),
      },
    });

    await tx.auditLog.create({
      data: {
        spaceId: space.id,
        actorUserId: user.id,
        actorName: user.name,
        action: "SPACE_CREATED",
        entityType: "Space",
        entityId: space.id,
        metadata: { isPersonal: true },
      },
    });

    return { userId: user.id, spaceId: space.id, name: user.name };
  });

  const url = `${env.APP_URL}/verify-email?token=${verification.plain}`;

  let verificationEmailSent = true;

  try {
    await deps.mailer.send({
      to: email,
      ...verifyEmailTemplate(
        result.name,
        url,
        env.EMAIL_VERIFICATION_TTL_HOURS,
      ),
    });
  } catch {
    /**
     * El mailer ya lo logueó con el email enmascarado y el detalle del
     * proveedor. Acá se traga a propósito: la cuenta existe y tirar ahora
     * dejaría a la persona con una cuenta que no sabe que tiene.
     *
     * El token de verificación sigue vivo y `/verify-email/resend` lo vuelve a
     * mandar cuando el correo esté arreglado.
     */
    verificationEmailSent = false;
  }

  return {
    userId: result.userId,
    spaceId: result.spaceId,
    verificationEmailSent,
  };
};

/**
 * Siembra el catálogo por defecto en un Space recién creado.
 *
 * Se exporta porque también lo usa la creación de Spaces adicionales
 * (incremento 5), no solo el registro.
 *
 * Los padres se crean con `createMany` en una sola ida a la base; las hijas
 * necesitan el id del padre, así que van en una segunda tanda.
 */
export const seedCategories = async (
  tx: Pick<ReturnType<typeof systemClient>, "category">,
  spaceId: string,
  locale: string,
): Promise<void> => {
  const catalog = getDefaultCategories(locale);

  for (const [kind, group] of [
    ["INCOME", catalog.income],
    ["EXPENSE", catalog.expense],
  ] as const) {
    let sortOrder = 0;

    for (const parent of group) {
      const created = await tx.category.create({
        data: {
          spaceId,
          name: parent.name,
          kind,
          icon: parent.icon,
          color: parent.color,
          sortOrder,
          isSystem: true,
        },
      });
      sortOrder += 1;

      if (parent.children && parent.children.length > 0) {
        await tx.category.createMany({
          data: parent.children.map((child, index) => ({
            spaceId,
            parentId: created.id,
            name: child.name,
            kind,
            icon: child.icon,
            color: child.color,
            sortOrder: index,
            isSystem: true,
          })),
        });
      }
    }
  }
};
