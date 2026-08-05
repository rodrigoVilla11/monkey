/**
 * Catálogo de errores de la API.
 *
 * Formato de respuesta, igual para todos los endpoints:
 *
 *   { "error": { "code": "...", "message": "...", "details"?: {...} } }
 *
 * El `code` es lo que consume el cliente para decidir qué hacer; el `message`
 * es texto para humanos y puede cambiar sin romper a nadie.
 *
 * Módulo puro: lo importa tanto el servidor como el cliente web, y mañana un
 * cliente Expo.
 */

export const API_ERROR_CODES = [
  // 400
  "VALIDATION_ERROR",
  "INVALID_REQUEST",
  // 401
  "UNAUTHENTICATED",
  "INVALID_CREDENTIALS",
  "TOKEN_EXPIRED",
  "TOKEN_INVALID",
  // 403
  "FORBIDDEN",
  "EMAIL_NOT_VERIFIED",
  "INSUFFICIENT_ROLE",
  "ACCOUNT_LOCKED",
  // 404
  "NOT_FOUND",
  // 409
  "CONFLICT",
  "EMAIL_ALREADY_REGISTERED",
  "ALREADY_MEMBER",
  // 422
  "UNPROCESSABLE",
  // 429
  "RATE_LIMITED",
  // 500
  "INTERNAL_ERROR",
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export interface ApiErrorBody {
  readonly error: {
    readonly code: ApiErrorCode;
    readonly message: string;
    readonly details?: unknown;
  };
}

/**
 * Código HTTP de cada error. Está acá y no en el servidor para que el cliente
 * pueda razonar sobre los mismos pares sin duplicar la tabla.
 */
export const HTTP_STATUS_BY_CODE: Readonly<Record<ApiErrorCode, number>> = {
  VALIDATION_ERROR: 400,
  INVALID_REQUEST: 400,

  UNAUTHENTICATED: 401,
  INVALID_CREDENTIALS: 401,
  TOKEN_EXPIRED: 401,
  TOKEN_INVALID: 401,

  FORBIDDEN: 403,
  EMAIL_NOT_VERIFIED: 403,
  INSUFFICIENT_ROLE: 403,
  ACCOUNT_LOCKED: 403,

  /**
   * Ojo: un recurso que existe pero pertenece a otro Space también responde
   * 404, nunca 403. Un 403 confirmaría que el recurso existe.
   */
  NOT_FOUND: 404,

  CONFLICT: 409,
  EMAIL_ALREADY_REGISTERED: 409,
  ALREADY_MEMBER: 409,

  UNPROCESSABLE: 422,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
};

export const isApiErrorBody = (value: unknown): value is ApiErrorBody => {
  if (typeof value !== "object" || value === null) return false;
  const { error } = value as { error?: unknown };
  if (typeof error !== "object" || error === null) return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  return typeof code === "string" && typeof message === "string";
};
