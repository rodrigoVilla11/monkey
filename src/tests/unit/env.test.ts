import { describe, expect, it } from "vitest";

import { parseEnv } from "@/env.schema";

const base = {
  DATABASE_URL: "postgresql://monkey:monkey@localhost:5432/monkey",
  AUTH_SECRET: "x".repeat(32),
};

describe("parseEnv", () => {
  it("aplica los defaults regionales cuando no se definen", () => {
    const result = parseEnv(base);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.env.DEFAULT_LOCALE).toBe("es-ES");
    expect(result.env.DEFAULT_CURRENCY).toBe("EUR");
    expect(result.env.DEFAULT_TIMEZONE).toBe("Europe/Madrid");
    expect(result.env.ACCESS_TOKEN_TTL_MINUTES).toBe(15);
  });

  it("acepta una configuración argentina", () => {
    const result = parseEnv({
      ...base,
      DEFAULT_LOCALE: "es-AR",
      DEFAULT_CURRENCY: "ARS",
      DEFAULT_TIMEZONE: "America/Argentina/Buenos_Aires",
    });

    expect(result.ok).toBe(true);
  });

  it("trata una variable vacía como ausente", () => {
    // `FOO=` en un .env define la variable como "". Sin normalizar, cada campo
    // opcional fallaría por .min(1) en vez de caer en su default.
    const result = parseEnv({
      ...base,
      RESEND_API_KEY: "",
      CRON_SECRET: "",
      DEFAULT_CURRENCY: "",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.env.RESEND_API_KEY).toBeUndefined();
    expect(result.env.DEFAULT_CURRENCY).toBe("EUR");
  });

  it("rechaza una timezone IANA inexistente", () => {
    const result = parseEnv({ ...base, DEFAULT_TIMEZONE: "Europe/Madriz" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join()).toContain("DEFAULT_TIMEZONE");
  });

  it("rechaza una moneda que no tenga forma de ISO 4217", () => {
    expect(parseEnv({ ...base, DEFAULT_CURRENCY: "eur" }).ok).toBe(false);
    expect(parseEnv({ ...base, DEFAULT_CURRENCY: "EURO" }).ok).toBe(false);
    expect(parseEnv({ ...base, DEFAULT_CURRENCY: "ARS" }).ok).toBe(true);
  });

  it("exige AUTH_SECRET de al menos 32 caracteres", () => {
    const result = parseEnv({ ...base, AUTH_SECRET: "corto" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join()).toContain("AUTH_SECRET");
  });

  it("exige RESEND_API_KEY cuando el driver de mail es resend", () => {
    expect(parseEnv({ ...base, MAIL_DRIVER: "resend" }).ok).toBe(false);
    expect(
      parseEnv({ ...base, MAIL_DRIVER: "resend", RESEND_API_KEY: "re_x" }).ok,
    ).toBe(true);
  });

  it("exige host y puerto cuando el driver de mail es smtp", () => {
    const missing = parseEnv({ ...base, MAIL_DRIVER: "smtp" });
    expect(missing.ok).toBe(false);
    if (missing.ok) return;
    expect(missing.errors.join()).toContain("SMTP_HOST");
    expect(missing.errors.join()).toContain("SMTP_PORT");

    expect(
      parseEnv({
        ...base,
        MAIL_DRIVER: "smtp",
        SMTP_HOST: "localhost",
        SMTP_PORT: "1025",
      }).ok,
    ).toBe(true);
  });

  describe("en producción", () => {
    const prod = {
      ...base,
      NODE_ENV: "production",
      APP_URL: "https://monkey.example",
      MAIL_DRIVER: "resend",
      RESEND_API_KEY: "re_x",
      CRON_SECRET: "y".repeat(16),
    };

    it("acepta una configuración completa", () => {
      expect(parseEnv(prod).ok).toBe(true);
    });

    it("no deja mandar los mails por consola", () => {
      const result = parseEnv({ ...prod, MAIL_DRIVER: "console" });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.errors.join()).toContain("MAIL_DRIVER");
    });

    it("exige CRON_SECRET", () => {
      const { CRON_SECRET: _omitted, ...withoutSecret } = prod;
      const result = parseEnv(withoutSecret);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.errors.join()).toContain("CRON_SECRET");
    });

    it("exige https en APP_URL porque las cookies van con Secure", () => {
      const result = parseEnv({ ...prod, APP_URL: "http://monkey.example" });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.errors.join()).toContain("APP_URL");
    });
  });
});
