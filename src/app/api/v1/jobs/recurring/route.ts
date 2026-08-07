import { timingSafeEqual } from "node:crypto";
import { z } from "zod";

import { env } from "@/env";
import { route } from "@/server/api/handler";
import { errors } from "@/server/api/errors";
import { json } from "@/server/api/responses";
import { materializeDueRules } from "@/server/services/recurring/materialize";
import { calendarDateSchema } from "@/shared/contracts/common";

export const runtime = "nodejs";

const paramsSchema = z.object({
  /**
   * Hasta qué fecha materializar. Sirve para reprocesar a mano un atraso
   * puntual sin esperar al reloj; por defecto es hoy.
   */
  until: calendarDateSchema.optional(),
});
type Params = z.infer<typeof paramsSchema>;

/**
 * POST — materializa las reglas vencidas de TODOS los Spaces.
 *
 * Es el único endpoint del sistema que cruza Spaces, y por eso no se autentica
 * con sesión sino con un secreto compartido: no hay un usuario detrás, hay un
 * cron. Fuera de desarrollo, `CRON_SECRET` es obligatorio y lo verifica el
 * esquema de env al arrancar.
 *
 * Va con `Authorization: Bearer <CRON_SECRET>` y se compara en tiempo constante:
 * una comparación con `===` filtra el largo del prefijo correcto por el tiempo
 * de respuesta.
 *
 * Es idempotente por diseño. Dispararlo dos veces seguidas no duplica nada: lo
 * impide el unique parcial (spaceId, recurringRuleId, date).
 *
 * Ejemplo de crontab, todos los días a las 03:15:
 *
 *   15 3 * * * curl -fsS -X POST \
 *     -H "Authorization: Bearer $CRON_SECRET" \
 *     https://monkey.example/api/v1/jobs/recurring
 */
export const POST = route<undefined, Params>(
  {
    params: paramsSchema,
    // Rate limit por IP igualmente: el endpoint no tiene sesión y hace trabajo
    // pesado, así que no puede quedar expuesto a un bombardeo.
    rateLimit: { limit: 10, windowSeconds: 60 },
  },
  async ({ request, params, logger }) => {
    requireCronSecret(request.headers.get("authorization"));

    const started = Date.now();
    const report = await materializeDueRules({
      ...(params.until !== undefined ? { until: params.until } : {}),
      logger,
    });

    logger.info(
      { ...report, durationMs: Date.now() - started },
      "job de recurrentes terminado",
    );

    return json(report);
  },
);

/**
 * Compara el secreto sin filtrar información por el tiempo de respuesta.
 *
 * `timingSafeEqual` exige buffers del mismo largo, así que la diferencia de
 * largo se descarta antes — eso sí es observable, pero el largo del secreto no
 * es lo que lo protege.
 */
const requireCronSecret = (header: string | null): void => {
  const expected = env.CRON_SECRET;

  if (expected === undefined) {
    // Solo puede pasar en desarrollo: el esquema de env lo exige en producción.
    throw errors.conflict(
      "UNPROCESSABLE",
      "CRON_SECRET no está configurado en este entorno",
    );
  }

  const provided = header?.startsWith("Bearer ")
    ? header.slice("Bearer ".length)
    : null;

  if (provided === null) throw errors.unauthenticated();

  const a = Buffer.from(provided);
  const b = Buffer.from(expected);

  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw errors.unauthenticated();
  }
};
