import {
  HTTP_STATUS_BY_CODE,
  type ApiErrorCode,
  type ApiErrorBody,
} from "@/shared/errors";

/**
 * Error de dominio con código de API.
 *
 * Los services tiran esto; el wrapper de handlers lo traduce a una respuesta
 * HTTP con el formato uniforme `{ error: { code, message, details? } }`.
 * Así la lógica de negocio no toca `NextResponse` y se puede testear sola.
 */
export class ApiError extends Error {
  public readonly code: ApiErrorCode;
  public readonly status: number;
  public readonly details?: unknown;

  public constructor(code: ApiErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = HTTP_STATUS_BY_CODE[code];
    if (details !== undefined) this.details = details;
  }

  public toBody(): ApiErrorBody {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details !== undefined ? { details: this.details } : {}),
      },
    };
  }
}

/**
 * Atajos para los errores frecuentes.
 *
 * `notFound` es el que más importa: cuando un recurso existe pero es de otro
 * Space, la respuesta tiene que ser 404 y no 403. Un 403 confirmaría que el
 * recurso existe, que es justo lo que no queremos filtrar.
 */
export const errors = {
  validation: (details: unknown): ApiError =>
    new ApiError(
      "VALIDATION_ERROR",
      "Los datos enviados no son válidos",
      details,
    ),

  unauthenticated: (): ApiError =>
    new ApiError("UNAUTHENTICATED", "Necesitás iniciar sesión"),

  invalidCredentials: (): ApiError =>
    new ApiError("INVALID_CREDENTIALS", "Email o contraseña incorrectos"),

  tokenInvalid: (message = "El enlace no es válido o ya se usó"): ApiError =>
    new ApiError("TOKEN_INVALID", message),

  tokenExpired: (message = "El enlace venció"): ApiError =>
    new ApiError("TOKEN_EXPIRED", message),

  emailNotVerified: (): ApiError =>
    new ApiError("EMAIL_NOT_VERIFIED", "Verificá tu email antes de continuar"),

  accountLocked: (): ApiError =>
    new ApiError(
      "ACCOUNT_LOCKED",
      "Demasiados intentos fallidos. Probá de nuevo en unos minutos",
    ),

  forbidden: (message = "No tenés permiso para hacer esto"): ApiError =>
    new ApiError("FORBIDDEN", message),

  insufficientRole: (
    message = "Tu rol no alcanza para esta acción",
  ): ApiError => new ApiError("INSUFFICIENT_ROLE", message),

  notFound: (message = "No se encontró el recurso"): ApiError =>
    new ApiError("NOT_FOUND", message),

  conflict: (code: ApiErrorCode, message: string): ApiError =>
    new ApiError(code, message),

  rateLimited: (retryAfterSeconds: number): ApiError =>
    new ApiError("RATE_LIMITED", "Demasiadas peticiones. Esperá un momento", {
      retryAfterSeconds,
    }),

  internal: (): ApiError =>
    new ApiError("INTERNAL_ERROR", "Algo salió mal de nuestro lado"),
};
