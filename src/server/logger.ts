import pino, { type Logger } from "pino";

import { env } from "@/env";

/**
 * Logging estructurado.
 *
 * Reglas, no sugerencias:
 *  · Nunca se loguean tokens, hashes de password ni importes. Un log de una
 *    app de finanzas no puede ser una filtración de datos financieros.
 *  · Los emails van enmascarados (`maskEmail`).
 *  · Cada request lleva `requestId`, y `userId` / `spaceId` cuando existen.
 *
 * `redact` es la red de seguridad por si alguien loguea un objeto entero sin
 * pensarlo.
 */
const REDACTED_PATHS = [
  "password",
  "newPassword",
  "currentPassword",
  "passwordHash",
  "token",
  "accessToken",
  "refreshToken",
  "tokenHash",
  "authorization",
  "cookie",
  "*.password",
  "*.token",
  "*.accessToken",
  "*.refreshToken",
  "*.passwordHash",
  "req.headers.authorization",
  "req.headers.cookie",
];

export const logger: Logger = pino({
  level: env.LOG_LEVEL,
  redact: { paths: REDACTED_PATHS, censor: "[redactado]" },
  base: { app: "monkey" },
  ...(env.NODE_ENV === "development"
    ? {
        transport: {
          target: "pino-pretty",
          options: { colorize: true, translateTime: "HH:MM:ss" },
        },
      }
    : {}),
});

export interface RequestContext {
  readonly requestId: string;
  readonly userId?: string;
  readonly spaceId?: string;
  readonly route?: string;
  readonly method?: string;
}

/**
 * Logger hijo con el contexto del request. Se crea una vez en el wrapper de
 * handlers y se pasa a los services, para que todo lo que se loguee durante un
 * request sea correlacionable.
 */
export const requestLogger = (context: RequestContext): Logger =>
  logger.child(context);
