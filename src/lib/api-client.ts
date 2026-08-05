import { isApiErrorBody, type ApiErrorCode } from "@/shared/errors";

/**
 * Cliente HTTP de la API v1.
 *
 * El frontend web habla con la MISMA API que hablaría un cliente Expo: no hay
 * atajos, ni Server Actions, ni acceso directo a Prisma desde componentes. Si
 * algo funciona acá, funciona igual desde una app nativa.
 *
 * Las cookies van solas (`credentials: "include"`) y son httpOnly, así que
 * este código nunca ve un token. Un XSS no puede robarse la sesión.
 */

export class ApiError extends Error {
  public readonly code: ApiErrorCode;
  public readonly status: number;
  public readonly details: unknown;

  public constructor(
    code: ApiErrorCode,
    message: string,
    status: number,
    details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

const BASE = "/api/v1";

interface RequestOptions {
  readonly method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  readonly body?: unknown;
  readonly signal?: AbortSignal;
}

/**
 * Renovación de sesión.
 *
 * Cuando un access token vence (15 min), el siguiente request devuelve 401. En
 * vez de mandar a la persona al login, se renueva y se reintenta una vez.
 *
 * La promesa se comparte: si cinco queries fallan a la vez al volver de tener
 * la app en segundo plano, se hace UN solo refresh y las cinco esperan al
 * mismo. Sin esto, cinco refresh en paralelo rotarían el token cinco veces y
 * cuatro darían "reuso detectado" — que cierra todas las sesiones.
 */
let refreshInFlight: Promise<boolean> | null = null;

const refreshSession = async (): Promise<boolean> => {
  refreshInFlight ??= (async () => {
    try {
      const response = await fetch(`${BASE}/auth/refresh`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
        credentials: "include",
      });
      return response.ok;
    } catch {
      return false;
    } finally {
      // Se libera en el microtask siguiente para que los que se colgaron de
      // esta promesa lleguen a leer el resultado.
      queueMicrotask(() => {
        refreshInFlight = null;
      });
    }
  })();

  return refreshInFlight;
};

/** Se dispara cuando la sesión se pierde de verdad. Lo escucha el shell. */
export const SESSION_EXPIRED_EVENT = "monkey:session-expired";

const parseError = async (response: Response): Promise<ApiError> => {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (isApiErrorBody(payload)) {
    return new ApiError(
      payload.error.code,
      payload.error.message,
      response.status,
      payload.error.details,
    );
  }

  return new ApiError(
    "INTERNAL_ERROR",
    "No se pudo completar la operación",
    response.status,
  );
};

const send = async (path: string, options: RequestOptions): Promise<Response> =>
  fetch(`${BASE}${path}`, {
    method: options.method ?? "GET",
    headers:
      options.body === undefined
        ? undefined
        : { "content-type": "application/json" },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    credentials: "include",
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
  });

export const apiFetch = async <T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> => {
  let response = await send(path, options);

  // 401 → un intento de renovación y un reintento. Solo uno: si el refresh
  // tampoco vale, insistir sería un bucle.
  if (response.status === 401 && !path.startsWith("/auth/")) {
    const renewed = await refreshSession();

    if (!renewed) {
      window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));
      throw await parseError(response);
    }

    response = await send(path, options);
  }

  if (!response.ok) throw await parseError(response);

  // 204 y respuestas sin cuerpo.
  if (response.status === 204) return undefined as T;

  return (await response.json()) as T;
};

export const api = {
  get: <T>(path: string, signal?: AbortSignal): Promise<T> =>
    apiFetch<T>(path, signal !== undefined ? { signal } : {}),
  post: <T>(path: string, body?: unknown): Promise<T> =>
    apiFetch<T>(path, { method: "POST", body: body ?? {} }),
  patch: <T>(path: string, body: unknown): Promise<T> =>
    apiFetch<T>(path, { method: "PATCH", body }),
  put: <T>(path: string, body: unknown): Promise<T> =>
    apiFetch<T>(path, { method: "PUT", body }),
  delete: <T>(path: string): Promise<T> =>
    apiFetch<T>(path, { method: "DELETE" }),
};

/** Construye una query string omitiendo lo vacío. */
export const qs = (
  params: Record<
    string,
    string | number | boolean | undefined | null | string[]
  >,
): string => {
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) {
      for (const item of value) search.append(key, item);
    } else {
      search.set(key, String(value));
    }
  }

  const text = search.toString();
  return text === "" ? "" : `?${text}`;
};
