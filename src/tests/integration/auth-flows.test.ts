import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { hashPassword, verifyPassword } from "@/server/auth/password";
import {
  hashToken,
  signAccessToken,
  verifyAccessToken,
} from "@/server/auth/tokens";
import { InMemoryMailer } from "@/server/mail/mailer";
import { login } from "@/server/services/auth/login";
import {
  changePassword,
  requestPasswordReset,
  resetPassword,
  resendVerification,
  verifyEmail,
} from "@/server/services/auth/password-flows";
import { getProfile, setActiveSpace } from "@/server/services/auth/profile";
import { register } from "@/server/services/auth/register";
import {
  listSessions,
  revokeAllSessions,
  revokeSessionById,
  rotateSession,
} from "@/server/services/auth/sessions";
import { forSpace } from "@/server/db/scoped";

import { disconnect, resetDatabase, testDb } from "./helpers/db";

const mailer = new InMemoryMailer();
const PASSWORD = "una-contraseña-bien-larga";

beforeEach(async () => {
  await resetDatabase();
  mailer.clear();
});

afterAll(async () => {
  await resetDatabase();
  await disconnect();
});

const createAccount = async (email = "rodrigo@ejemplo.com") => {
  const result = await register(
    { email, password: PASSWORD, name: "Rodrigo" },
    { mailer },
  );
  return result;
};

/** Saca el token del enlace que fue en el mail. */
const tokenFromMail = (to: string): string => {
  const message = mailer.lastTo(to);
  const match = /token=([\w-]+)/.exec(message?.text ?? "");
  if (!match?.[1]) throw new Error(`No hay token en el mail a ${to}`);
  return match[1];
};

describe("hash de contraseñas", () => {
  it("usa argon2id y verifica correctamente", async () => {
    const hash = await hashPassword(PASSWORD);

    expect(hash).toMatch(/^\$argon2id\$/);
    expect(await verifyPassword(hash, PASSWORD)).toBe(true);
    expect(await verifyPassword(hash, "otra-cosa-distinta")).toBe(false);
  });

  it("da hashes distintos para la misma contraseña", () => {
    // El salt aleatorio impide comparar hashes entre usuarios para saber
    // quiénes comparten contraseña.
    return Promise.all([hashPassword(PASSWORD), hashPassword(PASSWORD)]).then(
      ([a, b]) => {
        expect(a).not.toBe(b);
      },
    );
  });

  it("devuelve false ante un hash corrupto en vez de reventar", async () => {
    expect(await verifyPassword("no-es-un-hash", PASSWORD)).toBe(false);
  });
});

describe("access tokens", () => {
  it("hace ida y vuelta con sus claims", async () => {
    const token = await signAccessToken("user-1", "session-1");
    const claims = await verifyAccessToken(token);

    expect(claims?.userId).toBe("user-1");
    expect(claims?.sessionId).toBe("session-1");
  });

  it("rechaza un token manipulado", async () => {
    const token = await signAccessToken("user-1", "session-1");
    const tampered = `${token.slice(0, -3)}xyz`;

    expect(await verifyAccessToken(tampered)).toBeNull();
    expect(await verifyAccessToken("no-es-un-jwt")).toBeNull();
  });
});

describe("registro", () => {
  it("crea usuario, Space personal, membresía OWNER y categorías", async () => {
    const { userId, spaceId } = await createAccount();

    const user = await testDb.user.findUnique({ where: { id: userId } });
    expect(user?.email).toBe("rodrigo@ejemplo.com");
    expect(user?.emailVerifiedAt).toBeNull();
    expect(user?.activeSpaceId).toBe(spaceId);

    const space = await testDb.space.findUnique({ where: { id: spaceId } });
    expect(space?.isPersonal).toBe(true);

    const membership = await testDb.membership.findFirst({
      where: { spaceId },
    });
    expect(membership?.role).toBe("OWNER");

    const categories = await forSpace(spaceId).category.findMany();
    expect(categories.length).toBeGreaterThan(30);
    expect(categories.some((c) => c.kind === "INCOME")).toBe(true);
    expect(categories.some((c) => c.parentId !== null)).toBe(true);
  });

  it("normaliza el email antes de guardarlo", async () => {
    const { userId } = await createAccount("  Rodrigo@Ejemplo.COM ");
    const user = await testDb.user.findUnique({ where: { id: userId } });

    expect(user?.email).toBe("rodrigo@ejemplo.com");
  });

  it("no deja registrar dos veces el mismo email, ni con otro casing", async () => {
    await createAccount("ana@ejemplo.com");

    await expect(createAccount("ANA@ejemplo.com")).rejects.toMatchObject({
      code: "EMAIL_ALREADY_REGISTERED",
    });
  });

  it("manda el mail de verificación con un token utilizable", async () => {
    await createAccount();

    const message = mailer.lastTo("rodrigo@ejemplo.com");
    expect(message?.subject).toContain("Verificá");
    expect(tokenFromMail("rodrigo@ejemplo.com")).toBeTruthy();
  });

  it("guarda el token de verificación hasheado, nunca en claro", async () => {
    const { userId } = await createAccount();
    const plain = tokenFromMail("rodrigo@ejemplo.com");

    const stored = await testDb.verificationToken.findFirst({
      where: { userId },
    });

    expect(stored?.tokenHash).toBe(hashToken(plain));
    expect(stored?.tokenHash).not.toBe(plain);
  });

  it("usa los defaults regionales del entorno si no se especifican", async () => {
    const { userId, spaceId } = await createAccount();

    const user = await testDb.user.findUnique({ where: { id: userId } });
    const space = await testDb.space.findUnique({ where: { id: spaceId } });

    expect(user?.locale).toBe("es-ES");
    expect(user?.timezone).toBe("Europe/Madrid");
    expect(space?.primaryCurrency).toBe("EUR");
  });

  it("respeta los datos regionales que llegan en el registro", async () => {
    const { userId, spaceId } = await register(
      {
        email: "porteño@ejemplo.com",
        password: PASSWORD,
        name: "Rodrigo",
        timezone: "America/Argentina/Buenos_Aires",
        locale: "es-AR",
        currency: "ARS",
      },
      { mailer },
    );

    const user = await testDb.user.findUnique({ where: { id: userId } });
    const space = await testDb.space.findUnique({ where: { id: spaceId } });

    expect(user?.timezone).toBe("America/Argentina/Buenos_Aires");
    expect(space?.primaryCurrency).toBe("ARS");
  });

  /**
   * Regresión de un fallo que apareció en el primer despliegue real.
   *
   * El proveedor de correo rechazaba los envíos y el registro entero fallaba
   * DESPUÉS de que la transacción hubiera confirmado: la cuenta quedaba creada,
   * quien se registraba veía "algo salió mal de nuestro lado", y al reintentar
   * le decían que el email ya estaba en uso.
   */
  describe("cuando el correo no sale", () => {
    /** Un mailer que siempre falla, como un proveedor mal configurado. */
    const brokenMailer = {
      send: (): Promise<void> =>
        Promise.reject(new Error("dominio no verificado")),
    };

    it("la cuenta se crea igual y se avisa que el mail no salió", async () => {
      const result = await register(
        { email: "sin-mail@ejemplo.com", password: PASSWORD, name: "Rodrigo" },
        { mailer: brokenMailer },
      );

      expect(result.verificationEmailSent).toBe(false);

      // Lo que importa: la cuenta EXISTE y es usable.
      const user = await testDb.user.findUnique({
        where: { id: result.userId },
      });
      expect(user?.email).toBe("sin-mail@ejemplo.com");
    });

    it("el Space personal y sus categorías se crean igual", async () => {
      const { spaceId } = await register(
        { email: "sin-mail2@ejemplo.com", password: PASSWORD, name: "Rodrigo" },
        { mailer: brokenMailer },
      );

      const categories = await testDb.category.count({ where: { spaceId } });
      expect(categories).toBeGreaterThan(0);
    });

    it("el token de verificación queda vivo para reenviarlo después", async () => {
      // Es lo que hace que el fallo sea recuperable sin tocar la base.
      const { userId } = await register(
        { email: "sin-mail3@ejemplo.com", password: PASSWORD, name: "Rodrigo" },
        { mailer: brokenMailer },
      );

      const tokens = await testDb.verificationToken.count({
        where: { userId, type: "EMAIL_VERIFICATION", usedAt: null },
      });
      expect(tokens).toBe(1);
    });

    it("con el correo funcionando, avisa que sí salió", async () => {
      const result = await createAccount("con-mail@ejemplo.com");
      expect(result.verificationEmailSent).toBe(true);
    });
  });
});

describe("verificación de email", () => {
  it("marca la cuenta como verificada", async () => {
    const { userId } = await createAccount();
    await verifyEmail(tokenFromMail("rodrigo@ejemplo.com"));

    const user = await testDb.user.findUnique({ where: { id: userId } });
    expect(user?.emailVerifiedAt).not.toBeNull();
  });

  it("el token es de un solo uso", async () => {
    await createAccount();
    const token = tokenFromMail("rodrigo@ejemplo.com");

    await verifyEmail(token);
    await expect(verifyEmail(token)).rejects.toMatchObject({
      code: "TOKEN_INVALID",
    });
  });

  it("rechaza un token inventado", async () => {
    await expect(verifyEmail("token-falso")).rejects.toMatchObject({
      code: "TOKEN_INVALID",
    });
  });

  it("un token vencido da TOKEN_EXPIRED, no TOKEN_INVALID", async () => {
    const { userId } = await createAccount();
    await testDb.verificationToken.updateMany({
      where: { userId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    await expect(
      verifyEmail(tokenFromMail("rodrigo@ejemplo.com")),
    ).rejects.toMatchObject({ code: "TOKEN_EXPIRED" });
  });

  it("reenviar invalida el enlace anterior", async () => {
    const { userId } = await createAccount();
    const first = tokenFromMail("rodrigo@ejemplo.com");

    await resendVerification(userId, { mailer });
    const second = tokenFromMail("rodrigo@ejemplo.com");

    expect(second).not.toBe(first);
    await expect(verifyEmail(first)).rejects.toMatchObject({
      code: "TOKEN_INVALID",
    });
    await verifyEmail(second);
  });

  it("reenviar a una cuenta ya verificada no manda nada ni falla", async () => {
    const { userId } = await createAccount();
    await verifyEmail(tokenFromMail("rodrigo@ejemplo.com"));
    mailer.clear();

    await resendVerification(userId, { mailer });
    expect(mailer.sent).toHaveLength(0);
  });
});

describe("login", () => {
  it("devuelve una sesión con credenciales correctas", async () => {
    const { userId } = await createAccount();

    const result = await login(
      { email: "rodrigo@ejemplo.com", password: PASSWORD },
      {},
    );

    expect(result.userId).toBe(userId);
    expect(result.session.accessToken).toBeTruthy();
    expect(result.session.refreshToken).toBeTruthy();
    expect(result.session.tokenType).toBe("Bearer");
  });

  it("da el mismo error para email inexistente y contraseña incorrecta", async () => {
    await createAccount();

    const wrongPassword = await login(
      { email: "rodrigo@ejemplo.com", password: "incorrecta-pero-larga" },
      {},
    ).catch((e: unknown) => e);

    const noSuchUser = await login(
      { email: "nadie@ejemplo.com", password: PASSWORD },
      {},
    ).catch((e: unknown) => e);

    // Mensajes idénticos: si difirieran, se podría enumerar qué cuentas existen.
    expect(wrongPassword).toMatchObject({ code: "INVALID_CREDENTIALS" });
    expect(noSuchUser).toMatchObject({ code: "INVALID_CREDENTIALS" });
    expect((wrongPassword as Error).message).toBe(
      (noSuchUser as Error).message,
    );
  });

  it("guarda el refresh token hasheado", async () => {
    await createAccount();
    const { session } = await login(
      { email: "rodrigo@ejemplo.com", password: PASSWORD },
      {},
    );

    const stored = await testDb.refreshToken.findUnique({
      where: { id: session.sessionId },
    });

    expect(stored?.tokenHash).toBe(hashToken(session.refreshToken));
    expect(stored?.tokenHash).not.toBe(session.refreshToken);
  });

  it("bloquea la cuenta tras varios intentos fallidos", async () => {
    await createAccount();

    for (let i = 0; i < 8; i += 1) {
      await login(
        { email: "rodrigo@ejemplo.com", password: "mal-pero-larga" },
        {},
      ).catch(() => undefined);
    }

    // Ahora ni la contraseña correcta entra: el bloqueo es por cuenta y vive
    // en la base, así que sobrevive a un redeploy.
    await expect(
      login({ email: "rodrigo@ejemplo.com", password: PASSWORD }, {}),
    ).rejects.toMatchObject({ code: "ACCOUNT_LOCKED" });
  });

  it("un login exitoso limpia el contador de fallos", async () => {
    const { userId } = await createAccount();

    await login(
      { email: "rodrigo@ejemplo.com", password: "mal-pero-larga" },
      {},
    ).catch(() => undefined);

    await login({ email: "rodrigo@ejemplo.com", password: PASSWORD }, {});

    const user = await testDb.user.findUnique({ where: { id: userId } });
    expect(user?.failedLoginCount).toBe(0);
    expect(user?.lockedUntil).toBeNull();
  });
});

describe("rotación de refresh tokens", () => {
  it("entrega un par nuevo e invalida el anterior", async () => {
    await createAccount();
    const { session } = await login(
      { email: "rodrigo@ejemplo.com", password: PASSWORD },
      {},
    );

    const rotated = await rotateSession(session.refreshToken, {});

    expect(rotated.refreshToken).not.toBe(session.refreshToken);
    await expect(rotateSession(session.refreshToken, {})).rejects.toThrow();
  });

  it("reusar un token ya rotado cierra TODAS las sesiones", async () => {
    // Es la señal de que alguien se llevó una copia: como no se puede saber
    // cuál de las dos partes es la legítima, se echa a las dos.
    const { userId } = await createAccount();
    const { session: a } = await login(
      { email: "rodrigo@ejemplo.com", password: PASSWORD },
      {},
    );
    const { session: b } = await login(
      { email: "rodrigo@ejemplo.com", password: PASSWORD },
      {},
    );

    const rotated = await rotateSession(a.refreshToken, {});

    // El atacante intenta usar el token viejo que copió.
    await expect(rotateSession(a.refreshToken, {})).rejects.toMatchObject({
      code: "TOKEN_INVALID",
    });

    // Cae todo: la sesión rotada, la otra sesión, todo.
    const alive = await testDb.refreshToken.count({
      where: { userId, revokedAt: null },
    });
    expect(alive).toBe(0);
    await expect(rotateSession(rotated.refreshToken, {})).rejects.toThrow();
    await expect(rotateSession(b.refreshToken, {})).rejects.toThrow();
  });

  it("rechaza un refresh token vencido", async () => {
    await createAccount();
    const { session } = await login(
      { email: "rodrigo@ejemplo.com", password: PASSWORD },
      {},
    );

    await testDb.refreshToken.update({
      where: { id: session.sessionId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    await expect(rotateSession(session.refreshToken, {})).rejects.toMatchObject(
      {
        code: "TOKEN_EXPIRED",
      },
    );
  });
});

describe("gestión de sesiones activas", () => {
  it("lista los dispositivos y marca el actual", async () => {
    await createAccount();
    const { session: movil } = await login(
      {
        email: "rodrigo@ejemplo.com",
        password: PASSWORD,
        deviceLabel: "iPhone",
      },
      {},
    );
    await login(
      {
        email: "rodrigo@ejemplo.com",
        password: PASSWORD,
        deviceLabel: "Portátil",
      },
      {},
    );

    const sessions = await listSessions(
      (await testDb.user.findFirstOrThrow()).id,
      movil.sessionId,
    );

    expect(sessions).toHaveLength(2);
    expect(sessions.filter((s) => s.current)).toHaveLength(1);
    expect(sessions.map((s) => s.deviceLabel)).toContain("iPhone");
  });

  it("no se puede cerrar la sesión de otra persona", async () => {
    const otra = await createAccount("otra@ejemplo.com");
    const propia = await createAccount("propia@ejemplo.com");

    const { session } = await login(
      { email: "otra@ejemplo.com", password: PASSWORD },
      {},
    );

    // 404, no 403: no se confirma que la sesión exista.
    await expect(
      revokeSessionById(propia.userId, session.sessionId),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const stillAlive = await testDb.refreshToken.findUnique({
      where: { id: session.sessionId },
    });
    expect(stillAlive?.revokedAt).toBeNull();
    expect(otra.userId).not.toBe(propia.userId);
  });

  it("revoke-all invalida además los access tokens ya emitidos", async () => {
    const { userId } = await createAccount();
    await login({ email: "rodrigo@ejemplo.com", password: PASSWORD }, {});

    await revokeAllSessions(userId, "test");

    const user = await testDb.user.findUnique({ where: { id: userId } });
    // Sin esta marca, un access token vivo seguiría entrando hasta 15 minutos.
    expect(user?.sessionsRevokedAt).not.toBeNull();
    expect(
      await testDb.refreshToken.count({ where: { userId, revokedAt: null } }),
    ).toBe(0);
  });
});

describe("recuperación de contraseña", () => {
  it("manda el mail con un token de un solo uso", async () => {
    await createAccount();
    mailer.clear();

    await requestPasswordReset("rodrigo@ejemplo.com", { mailer });

    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]?.subject).toContain("contraseña");
  });

  it("con un email inexistente no manda nada Y NO falla", async () => {
    // Nunca revela si la cuenta existe.
    await requestPasswordReset("nadie@ejemplo.com", { mailer });
    expect(mailer.sent).toHaveLength(0);
  });

  it("cambia la contraseña y cierra todas las sesiones", async () => {
    const { userId } = await createAccount();
    await login({ email: "rodrigo@ejemplo.com", password: PASSWORD }, {});
    mailer.clear();

    await requestPasswordReset("rodrigo@ejemplo.com", { mailer });
    const token = tokenFromMail("rodrigo@ejemplo.com");

    await resetPassword(token, "otra-contraseña-larga", { mailer });

    // La vieja ya no sirve, la nueva sí.
    await expect(
      login({ email: "rodrigo@ejemplo.com", password: PASSWORD }, {}),
    ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    await login(
      { email: "rodrigo@ejemplo.com", password: "otra-contraseña-larga" },
      {},
    );

    const user = await testDb.user.findUnique({ where: { id: userId } });
    expect(user?.sessionsRevokedAt).not.toBeNull();
    // Quien abrió el mail controla la casilla: se aprovecha para verificarla.
    expect(user?.emailVerifiedAt).not.toBeNull();
  });

  it("el token de reset es de un solo uso", async () => {
    await createAccount();
    await requestPasswordReset("rodrigo@ejemplo.com", { mailer });
    const token = tokenFromMail("rodrigo@ejemplo.com");

    await resetPassword(token, "otra-contraseña-larga", { mailer });
    await expect(
      resetPassword(token, "tercera-contraseña-larga", { mailer }),
    ).rejects.toMatchObject({ code: "TOKEN_INVALID" });
  });

  it("pedir un reset nuevo invalida el anterior", async () => {
    await createAccount();
    await requestPasswordReset("rodrigo@ejemplo.com", { mailer });
    const first = tokenFromMail("rodrigo@ejemplo.com");

    await requestPasswordReset("rodrigo@ejemplo.com", { mailer });
    const second = tokenFromMail("rodrigo@ejemplo.com");

    await expect(
      resetPassword(first, "otra-contraseña-larga", { mailer }),
    ).rejects.toMatchObject({ code: "TOKEN_INVALID" });
    await resetPassword(second, "otra-contraseña-larga", { mailer });
  });

  it("desbloquea una cuenta bloqueada por intentos fallidos", async () => {
    const { userId } = await createAccount();
    for (let i = 0; i < 8; i += 1) {
      await login(
        { email: "rodrigo@ejemplo.com", password: "mal-pero-larga" },
        {},
      ).catch(() => undefined);
    }

    await requestPasswordReset("rodrigo@ejemplo.com", { mailer });
    await resetPassword(
      tokenFromMail("rodrigo@ejemplo.com"),
      "otra-contraseña-larga",
      { mailer },
    );

    const user = await testDb.user.findUnique({ where: { id: userId } });
    expect(user?.lockedUntil).toBeNull();
    await login(
      { email: "rodrigo@ejemplo.com", password: "otra-contraseña-larga" },
      {},
    );
  });
});

describe("cambio de contraseña desde el perfil", () => {
  it("exige la contraseña actual", async () => {
    const { userId } = await createAccount();

    await expect(
      changePassword(userId, "la-que-no-es", "nueva-contraseña-larga", {
        mailer,
      }),
    ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
  });

  it("cambia la contraseña y cierra todas las sesiones", async () => {
    const { userId } = await createAccount();
    await login({ email: "rodrigo@ejemplo.com", password: PASSWORD }, {});

    await changePassword(userId, PASSWORD, "nueva-contraseña-larga", {
      mailer,
    });

    expect(
      await testDb.refreshToken.count({ where: { userId, revokedAt: null } }),
    ).toBe(0);
    await login(
      { email: "rodrigo@ejemplo.com", password: "nueva-contraseña-larga" },
      {},
    );
  });
});

describe("perfil y Space activo", () => {
  it("devuelve el perfil sin exponer el hash de la contraseña", async () => {
    const { userId } = await createAccount();
    const profile = await getProfile(userId);

    expect(profile.email).toBe("rodrigo@ejemplo.com");
    expect(profile.emailVerified).toBe(false);
    expect(profile).not.toHaveProperty("passwordHash");
  });

  it("no deja activar un Space del que no sos miembro", async () => {
    const propia = await createAccount("propia@ejemplo.com");
    const ajena = await createAccount("ajena@ejemplo.com");

    // 404 y no 403: no se confirma que el Space exista.
    await expect(
      setActiveSpace(propia.userId, ajena.spaceId),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("deja activar un Space propio", async () => {
    const { userId, spaceId } = await createAccount();
    const profile = await setActiveSpace(userId, spaceId);

    expect(profile.activeSpaceId).toBe(spaceId);
  });
});
