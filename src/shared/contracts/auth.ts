import { z } from "zod";

import { isCurrencyCode } from "../currency";
import { isValidTimeZone } from "../dates";
import { normalizeEmail } from "../email";

/**
 * Contratos de autenticación: esquemas Zod y los tipos que salen de ellos.
 *
 * Son la MISMA definición que valida el servidor y que usa el formulario del
 * cliente. Un cliente Expo importa este archivo tal cual: no depende de Next,
 * de Prisma ni de React.
 */

export const emailSchema = z
  .string()
  .trim()
  .min(3)
  .max(254)
  .transform(normalizeEmail)
  .pipe(z.email("Email inválido"));

/**
 * Política de passwords: longitud por encima de todo.
 *
 * Nada de "una mayúscula, un número y un símbolo": esas reglas empujan a la
 * gente hacia "Password1!" y las guías modernas (NIST 800-63B) las
 * desaconsejan. 10 caracteres mínimo, 200 máximo — el tope existe porque
 * argon2 sobre una entrada de 1 MB es un vector de DoS.
 */
export const passwordSchema = z
  .string()
  .min(10, "La contraseña necesita al menos 10 caracteres")
  .max(200, "La contraseña no puede superar los 200 caracteres");

export const timezoneSchema = z
  .string()
  .refine(isValidTimeZone, "Timezone IANA inválida");

export const localeSchema = z
  .string()
  .regex(/^[a-z]{2}(-[A-Z]{2})?$/, "Locale inválido (ej: es-ES)");

export const currencySchema = z
  .string()
  .refine(isCurrencyCode, "Código de moneda ISO 4217 inválido");

// ─────────────────────────────── registro ────────────────────────────────────

export const registerRequestSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  name: z.string().trim().min(1, "El nombre es obligatorio").max(100),
  /**
   * Los tres se proponen desde el cliente (Accept-Language + la timezone del
   * navegador) y si no vienen, el servidor cae en los defaults del entorno.
   * No hay ningún país hardcodeado en el código.
   */
  timezone: timezoneSchema.optional(),
  locale: localeSchema.optional(),
  currency: currencySchema.optional(),
});

export type RegisterRequest = z.infer<typeof registerRequestSchema>;

// ──────────────────────────────── login ──────────────────────────────────────

export const loginRequestSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "La contraseña es obligatoria"),
  /** Nombre del dispositivo, para la pantalla de sesiones activas. */
  deviceLabel: z.string().trim().max(80).optional(),
});

export type LoginRequest = z.infer<typeof loginRequestSchema>;

// ─────────────────────────────── tokens ──────────────────────────────────────

/**
 * El refresh token viaja en el body solo para clientes nativos. La web lo
 * manda en una cookie httpOnly y no necesita este campo.
 */
export const refreshRequestSchema = z.object({
  refreshToken: z.string().min(1).optional(),
});

export type RefreshRequest = z.infer<typeof refreshRequestSchema>;

export interface AuthTokens {
  readonly accessToken: string;
  readonly refreshToken: string;
  /** Segundos de vida del access token, para que el cliente lo renueve antes. */
  readonly expiresIn: number;
  readonly tokenType: "Bearer";
}

// ───────────────────────── verificación y password ───────────────────────────

export const verifyEmailRequestSchema = z.object({
  token: z.string().min(1),
});

export const forgotPasswordRequestSchema = z.object({
  email: emailSchema,
});

export const resetPasswordRequestSchema = z.object({
  token: z.string().min(1),
  password: passwordSchema,
});

export const changePasswordRequestSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: passwordSchema,
});

export type VerifyEmailRequest = z.infer<typeof verifyEmailRequestSchema>;
export type ForgotPasswordRequest = z.infer<typeof forgotPasswordRequestSchema>;
export type ResetPasswordRequest = z.infer<typeof resetPasswordRequestSchema>;
export type ChangePasswordRequest = z.infer<typeof changePasswordRequestSchema>;

// ────────────────────────────── perfil ───────────────────────────────────────

export const updateProfileRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    timezone: timezoneSchema.optional(),
    locale: localeSchema.optional(),
    theme: z.enum(["SYSTEM", "LIGHT", "DARK"]).optional(),
    weekStartsOn: z.number().int().min(0).max(6).optional(),
    /**
     * Solo cambia qué moneda se propone por defecto al crear Spaces, cuentas y
     * deudas. La moneda de consolidación de los Spaces existentes no se toca.
     */
    preferredCurrency: currencySchema.optional(),
    avatarUrl: z.url().max(500).nullable().optional(),
  })
  .refine(
    (value) => Object.keys(value).length > 0,
    "Hay que mandar al menos un campo",
  );

export type UpdateProfileRequest = z.infer<typeof updateProfileRequestSchema>;

export const setActiveSpaceRequestSchema = z.object({
  spaceId: z.string().min(1),
});

// ────────────────────────────── respuestas ───────────────────────────────────

export interface SessionUser {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly avatarUrl: string | null;
  readonly timezone: string;
  readonly locale: string;
  readonly theme: "SYSTEM" | "LIGHT" | "DARK";
  readonly weekStartsOn: number;
  readonly preferredCurrency: string;
  readonly emailVerified: boolean;
  readonly activeSpaceId: string | null;
}

export interface AuthResponse {
  readonly user: SessionUser;
  /**
   * Solo se devuelven a clientes que los pidan explícitamente
   * (`X-Client-Type: native`). La web usa cookies httpOnly y nunca ve los
   * tokens desde JavaScript.
   */
  readonly tokens?: AuthTokens;
  /**
   * Solo en el registro. `false` = la cuenta se creó pero el mail de
   * verificación no salió (proveedor caído o mal configurado).
   *
   * Existe porque la alternativa era peor: antes un fallo de correo hacía
   * fallar el registro entero cuando la cuenta ya estaba creada, y quien se
   * registraba veía un error genérico y al reintentar le decían que el email
   * ya existía.
   */
  readonly verificationEmailSent?: boolean;
}

export interface ActiveSession {
  readonly id: string;
  readonly deviceLabel: string | null;
  readonly createdAt: string;
  readonly lastUsedAt: string | null;
  readonly expiresAt: string;
  /** La sesión desde la que se está haciendo la consulta. */
  readonly current: boolean;
}
