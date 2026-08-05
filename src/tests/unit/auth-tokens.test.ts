import { describe, expect, it } from "vitest";

import { maskEmail, normalizeEmail } from "@/shared/email";
import {
  changePasswordRequestSchema,
  loginRequestSchema,
  registerRequestSchema,
  passwordSchema,
} from "@/shared/contracts/auth";
import { HTTP_STATUS_BY_CODE, API_ERROR_CODES } from "@/shared/errors";

describe("normalización de email", () => {
  it("baja a minúsculas y recorta espacios", () => {
    expect(normalizeEmail("  Rodrigo@Ejemplo.COM ")).toBe(
      "rodrigo@ejemplo.com",
    );
  });

  it("hace que dos variantes sean la misma cuenta", () => {
    expect(normalizeEmail("Ana@x.com")).toBe(normalizeEmail("ana@X.com"));
  });

  it("enmascara para poder loguear sin exponer el dato", () => {
    expect(maskEmail("rodrigo@ejemplo.com")).toBe("r***o@ejemplo.com");
    expect(maskEmail("ab@x.com")).toBe("***@x.com");
    expect(maskEmail("sin-arroba")).toBe("***");
  });
});

describe("esquemas de auth", () => {
  it("normaliza el email al validarlo", () => {
    const result = loginRequestSchema.safeParse({
      email: "  Rodrigo@Ejemplo.COM ",
      password: "una-contraseña-larga",
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.email).toBe("rodrigo@ejemplo.com");
  });

  it("rechaza emails mal formados", () => {
    for (const email of ["no-es-email", "a@", "@b.com", ""]) {
      expect(
        loginRequestSchema.safeParse({ email, password: "x".repeat(12) })
          .success,
        email,
      ).toBe(false);
    }
  });

  describe("política de contraseñas", () => {
    it("exige al menos 10 caracteres", () => {
      expect(passwordSchema.safeParse("corta123").success).toBe(false);
      expect(passwordSchema.safeParse("1234567890").success).toBe(true);
    });

    it("acepta frases largas sin exigir símbolos raros", () => {
      // Regla deliberada: longitud sobre complejidad (NIST 800-63B).
      // "correcto caballo batería grapa" es mejor que "P@ssw0rd!".
      expect(
        passwordSchema.safeParse("correcto caballo batería grapa").success,
      ).toBe(true);
    });

    it("pone un techo, porque argon2 sobre 1 MB es un DoS", () => {
      expect(passwordSchema.safeParse("x".repeat(201)).success).toBe(false);
    });
  });

  it("acepta un registro sin datos regionales y los deja indefinidos", () => {
    // El servidor cae en DEFAULT_LOCALE / DEFAULT_TIMEZONE / DEFAULT_CURRENCY.
    const result = registerRequestSchema.safeParse({
      email: "nuevo@ejemplo.com",
      password: "una-contraseña-larga",
      name: "Rodrigo",
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.timezone).toBeUndefined();
    expect(result.data.locale).toBeUndefined();
    expect(result.data.currency).toBeUndefined();
  });

  it("acepta datos regionales de España y de Argentina", () => {
    for (const variant of [
      { timezone: "Europe/Madrid", locale: "es-ES", currency: "EUR" },
      {
        timezone: "America/Argentina/Buenos_Aires",
        locale: "es-AR",
        currency: "ARS",
      },
    ]) {
      const result = registerRequestSchema.safeParse({
        email: "nuevo@ejemplo.com",
        password: "una-contraseña-larga",
        name: "Rodrigo",
        ...variant,
      });
      expect(result.success, JSON.stringify(variant)).toBe(true);
    }
  });

  it("rechaza timezones y monedas inválidas", () => {
    const base = {
      email: "nuevo@ejemplo.com",
      password: "una-contraseña-larga",
      name: "Rodrigo",
    };
    expect(
      registerRequestSchema.safeParse({ ...base, timezone: "Marte/Olympus" })
        .success,
    ).toBe(false);
    expect(
      registerRequestSchema.safeParse({ ...base, currency: "eur" }).success,
    ).toBe(false);
  });

  it("el cambio de contraseña exige la actual", () => {
    expect(
      changePasswordRequestSchema.safeParse({
        newPassword: "una-contraseña-larga",
      }).success,
    ).toBe(false);

    expect(
      changePasswordRequestSchema.safeParse({
        currentPassword: "la-vieja",
        newPassword: "una-contraseña-larga",
      }).success,
    ).toBe(true);
  });
});

describe("catálogo de errores", () => {
  it("cada código tiene un status HTTP", () => {
    for (const code of API_ERROR_CODES) {
      expect(HTTP_STATUS_BY_CODE[code], code).toBeGreaterThanOrEqual(400);
    }
  });

  it("un recurso de otro Space responde 404, no 403", () => {
    // Un 403 confirmaría que el recurso existe.
    expect(HTTP_STATUS_BY_CODE.NOT_FOUND).toBe(404);
  });

  it("los errores de autenticación y de permisos se distinguen", () => {
    expect(HTTP_STATUS_BY_CODE.UNAUTHENTICATED).toBe(401);
    expect(HTTP_STATUS_BY_CODE.INSUFFICIENT_ROLE).toBe(403);
    expect(HTTP_STATUS_BY_CODE.RATE_LIMITED).toBe(429);
  });
});
