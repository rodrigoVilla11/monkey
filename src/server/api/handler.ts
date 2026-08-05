import { randomUUID } from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";
import type { Logger } from "pino";
import type { ZodType } from "zod";

import {
  resolveSession,
  type AuthenticatedSession,
} from "@/server/auth/session";
import { requestLogger } from "@/server/logger";
import { SpaceScopeError } from "@/server/db/space-scope";

import { ApiError, errors } from "./errors";
import { clientIp, rateLimiter } from "./rate-limit";
import { json } from "./responses";

/**
 * Wrapper de Route Handlers.
 *
 * Todos los endpoints de la API v1 pasan por acá, y por eso todos hacen
 * exactamente lo mismo y en el mismo orden:
 *
 *   rate limit → validar con Zod → resolver sesión → llamar al service → mapear
 *
 * La lógica de negocio NO vive en los handlers: viven en `services/**`, que son
 * funciones que reciben sus dependencias y no saben qué es un `NextRequest`.
 * Eso es lo que permite que la misma lógica sirva a la web, a un cliente Expo
 * y a un test sin montar HTTP.
 */

export interface RouteContext<TBody, TParams> {
  readonly request: NextRequest;
  readonly body: TBody;
  readonly params: TParams;
  readonly logger: Logger;
  readonly requestId: string;
  readonly ip: string;
}

export interface AuthedRouteContext<TBody, TParams> extends RouteContext<
  TBody,
  TParams
> {
  readonly session: AuthenticatedSession;
}

interface RouteOptions<TBody, TParams> {
  /** Esquema del body. Si no se pasa, el body no se lee. */
  readonly body?: ZodType<TBody>;
  /** Esquema de los parámetros de ruta y query. */
  readonly params?: ZodType<TParams>;
  /** Exige sesión válida. */
  readonly auth?: boolean;
  /**
   * Exige además email verificado. Solo tiene sentido con `auth: true`.
   * Los endpoints de dominio lo llevan siempre: una cuenta sin verificar
   * puede entrar y ver la pantalla de "verificá tu mail", nada más.
   */
  readonly verified?: boolean;
  readonly rateLimit?: {
    readonly limit: number;
    readonly windowSeconds: number;
  };
}

type Handler<TBody, TParams> = (
  context: RouteContext<TBody, TParams>,
) => Promise<NextResponse>;

type AuthedHandler<TBody, TParams> = (
  context: AuthedRouteContext<TBody, TParams>,
) => Promise<NextResponse>;

/** Lo que Next entrega como segundo argumento de un Route Handler. */
interface NextRouteArgs {
  readonly params: Promise<Record<string, string>>;
}

const parseBody = async (request: NextRequest): Promise<unknown> => {
  const contentLength = request.headers.get("content-length");
  if (contentLength === "0") return {};

  try {
    return await request.json();
  } catch {
    // Body vacío o JSON roto: se trata como objeto vacío y que decida Zod,
    // así el mensaje de error habla de campos y no de sintaxis.
    return {};
  }
};

const toResponse = (error: unknown, log: Logger): NextResponse => {
  if (error instanceof ApiError) {
    // 4xx es información para el cliente, no una falla del servidor.
    log.info({ code: error.code, status: error.status }, error.message);
    return json(error.toBody(), { status: error.status });
  }

  if (error instanceof SpaceScopeError) {
    // Llegar acá significa que un service intentó salirse de su Space. Es un
    // bug nuestro y hay que verlo en los logs, pero al cliente no se le cuenta.
    log.error({ err: error }, "violación del scope por Space");
    const wrapped = errors.internal();
    return json(wrapped.toBody(), { status: wrapped.status });
  }

  log.error({ err: error }, "error no controlado");
  const internal = errors.internal();
  return json(internal.toBody(), { status: internal.status });
};

type RouteEntry = (
  request: NextRequest,
  args?: NextRouteArgs,
) => Promise<NextResponse>;

/**
 * Sobrecargas: con `auth: true` el handler recibe `session` garantizada; sin
 * auth, no existe. Sin esto TypeScript no puede inferir el tipo del contexto
 * a partir de una unión y todos los handlers quedarían implícitamente `any`.
 */
export function route<TBody = undefined, TParams = undefined>(
  options: RouteOptions<TBody, TParams> & { auth: true },
  handler: AuthedHandler<TBody, TParams>,
): RouteEntry;
export function route<TBody = undefined, TParams = undefined>(
  options: RouteOptions<TBody, TParams> & { auth?: false | undefined },
  handler: Handler<TBody, TParams>,
): RouteEntry;
export function route<TBody = undefined, TParams = undefined>(
  options: RouteOptions<TBody, TParams>,
  handler: Handler<TBody, TParams> | AuthedHandler<TBody, TParams>,
): RouteEntry {
  return async (
    request: NextRequest,
    args?: NextRouteArgs,
  ): Promise<NextResponse> => {
    const requestId = randomUUID();
    const ip = clientIp(request.headers);
    const log = requestLogger({
      requestId,
      method: request.method,
      route: new URL(request.url).pathname,
    });

    try {
      if (options.rateLimit) {
        const key = `${new URL(request.url).pathname}:${ip}`;
        const result = rateLimiter.check(
          key,
          options.rateLimit.limit,
          options.rateLimit.windowSeconds,
        );
        if (!result.allowed) {
          throw errors.rateLimited(result.retryAfterSeconds);
        }
      }

      let body = undefined as TBody;
      if (options.body) {
        const raw = await parseBody(request);
        const parsed = options.body.safeParse(raw);
        if (!parsed.success) {
          throw errors.validation(
            parsed.error.issues.map((issue) => ({
              path: issue.path.join("."),
              message: issue.message,
            })),
          );
        }
        body = parsed.data;
      }

      let params = undefined as TParams;
      if (options.params) {
        const routeParams = args ? await args.params : {};
        const query = Object.fromEntries(new URL(request.url).searchParams);
        const parsed = options.params.safeParse({ ...query, ...routeParams });
        if (!parsed.success) {
          throw errors.validation(
            parsed.error.issues.map((issue) => ({
              path: issue.path.join("."),
              message: issue.message,
            })),
          );
        }
        params = parsed.data;
      }

      const base: RouteContext<TBody, TParams> = {
        request,
        body,
        params,
        logger: log,
        requestId,
        ip,
      };

      if (options.auth !== true) {
        return await (handler as Handler<TBody, TParams>)(base);
      }

      const session = await resolveSession(request);
      if (session === null) throw errors.unauthenticated();

      if (options.verified === true && !session.emailVerified) {
        throw errors.emailNotVerified();
      }

      const authedLog = log.child({ userId: session.userId });

      return await (handler as AuthedHandler<TBody, TParams>)({
        ...base,
        logger: authedLog,
        session,
      });
    } catch (error) {
      return toResponse(error, log);
    }
  };
}
