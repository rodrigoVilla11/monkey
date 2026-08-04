import { z } from "zod";

/**
 * Forma y reglas del entorno. Módulo PURO: no lee `process.env` ni tiene
 * efectos al importarse, así que los tests pueden ejercitar las reglas sin
 * montar un entorno completo.
 *
 * El singleton `env` que usa la app vive en `src/env.ts`.
 *
 * Este archivo no importa nada de Next, Prisma ni React: lo consumen
 * `next.config.ts`, `instrumentation.ts` y los scripts de `scripts/`.
 */

const isTimeZone = (value: string): boolean => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
};

const bool = (fallback: boolean) =>
  z
    .enum(["true", "false", "1", "0"])
    .default(fallback ? "true" : "false")
    .transform((v) => v === "true" || v === "1");

const port = z.coerce.number().int().min(1).max(65_535);

export const envSchema = z
  .object({
    // ── Core ──────────────────────────────────────────────────────────────
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    APP_URL: z.url().default("http://localhost:3000"),
    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace"])
      .default("info"),

    // ── Base de datos ─────────────────────────────────────────────────────
    DATABASE_URL: z
      .string()
      .min(1)
      .refine(
        (v) => v.startsWith("postgresql://") || v.startsWith("postgres://"),
        "DATABASE_URL tiene que ser una URL de PostgreSQL",
      ),

    // ── Auth ──────────────────────────────────────────────────────────────
    AUTH_SECRET: z
      .string()
      .min(32, "AUTH_SECRET necesita al menos 32 caracteres"),
    /** Ventana de revocación de sesión: ver §0.2 del plan. */
    ACCESS_TOKEN_TTL_MINUTES: z.coerce
      .number()
      .int()
      .min(1)
      .max(60)
      .default(15),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(60),
    EMAIL_VERIFICATION_TTL_HOURS: z.coerce.number().int().min(1).default(24),
    PASSWORD_RESET_TTL_MINUTES: z.coerce.number().int().min(5).default(60),
    INVITATION_TTL_DAYS: z.coerce.number().int().min(1).default(7),

    // ── Mail ──────────────────────────────────────────────────────────────
    MAIL_DRIVER: z.enum(["console", "smtp", "resend"]).default("console"),
    MAIL_FROM: z.string().min(3).default("Monkey <no-reply@localhost>"),
    RESEND_API_KEY: z.string().min(1).optional(),
    SMTP_HOST: z.string().min(1).optional(),
    SMTP_PORT: port.optional(),
    SMTP_USER: z.string().optional(),
    SMTP_PASSWORD: z.string().optional(),
    SMTP_SECURE: bool(false),

    // ── Defaults regionales ───────────────────────────────────────────────
    // No hay país hardcodeado en el código: todo sale de acá y el usuario
    // puede cambiarlo en el registro. Ver "Punto 1" del plan.
    DEFAULT_LOCALE: z
      .string()
      .regex(/^[a-z]{2}(-[A-Z]{2})?$/, "Formato esperado: es-ES, es-AR, en-US")
      .default("es-ES"),
    DEFAULT_CURRENCY: z
      .string()
      .regex(/^[A-Z]{3}$/, "Código ISO 4217 de 3 letras, ej: EUR, ARS")
      .default("EUR"),
    DEFAULT_TIMEZONE: z
      .string()
      .refine(isTimeZone, "Timezone IANA inválida, ej: Europe/Madrid")
      .default("Europe/Madrid"),

    // ── Storage (adjuntos, Fase 3) ────────────────────────────────────────
    STORAGE_DRIVER: z.enum(["local"]).default("local"),
    STORAGE_LOCAL_DIR: z.string().min(1).default("./var/uploads"),

    // ── Jobs (Fase 2) ─────────────────────────────────────────────────────
    CRON_SECRET: z.string().min(16).optional(),

    // ── Rate limiting ─────────────────────────────────────────────────────
    RATE_LIMIT_ENABLED: bool(true),
  })
  .superRefine((env, ctx) => {
    if (env.MAIL_DRIVER === "resend" && !env.RESEND_API_KEY) {
      ctx.addIssue({
        code: "custom",
        path: ["RESEND_API_KEY"],
        message: 'Obligatorio cuando MAIL_DRIVER="resend"',
      });
    }
    if (env.MAIL_DRIVER === "smtp") {
      if (!env.SMTP_HOST) {
        ctx.addIssue({
          code: "custom",
          path: ["SMTP_HOST"],
          message: 'Obligatorio cuando MAIL_DRIVER="smtp"',
        });
      }
      if (env.SMTP_PORT === undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["SMTP_PORT"],
          message: 'Obligatorio cuando MAIL_DRIVER="smtp"',
        });
      }
    }
    if (env.NODE_ENV === "production") {
      if (env.MAIL_DRIVER === "console") {
        ctx.addIssue({
          code: "custom",
          path: ["MAIL_DRIVER"],
          message:
            'No se puede usar "console" en producción: los mails de verificación e invitación nunca llegarían',
        });
      }
      if (!env.CRON_SECRET) {
        ctx.addIssue({
          code: "custom",
          path: ["CRON_SECRET"],
          message: "Obligatorio en producción",
        });
      }
      if (env.APP_URL.startsWith("http://")) {
        ctx.addIssue({
          code: "custom",
          path: ["APP_URL"],
          message:
            "Tiene que ser https en producción: las cookies de sesión van con Secure",
        });
      }
    }
  });

export type Env = z.infer<typeof envSchema>;

/**
 * En un .env o en un docker-compose, `FOO=` deja la variable definida como
 * string vacío, no ausente. Sin esto, cada campo `.optional()` fallaría por
 * `.min(1)` en vez de tomar su default.
 */
const stripEmpty = (
  source: Record<string, string | undefined>,
): Record<string, string | undefined> =>
  Object.fromEntries(
    Object.entries(source).filter(([, value]) => value !== ""),
  );

/**
 * Parseo puro, sin efectos ni lectura de `process.env`. Separado del singleton
 * `env` para que los tests puedan ejercitar las reglas sin montar un entorno.
 */
export const parseEnv = (
  source: Record<string, string | undefined>,
): { ok: true; env: Env } | { ok: false; errors: string[] } => {
  const result = envSchema.safeParse(stripEmpty(source));

  if (!result.success) {
    return {
      ok: false,
      errors: result.error.issues.map(
        (issue) => `${issue.path.join(".") || "(raíz)"}: ${issue.message}`,
      ),
    };
  }

  return { ok: true, env: result.data };
};
