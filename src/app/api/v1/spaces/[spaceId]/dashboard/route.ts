import { z } from "zod";

import { route } from "@/server/api/handler";
import { json } from "@/server/api/responses";
import { systemClient } from "@/server/db/system";
import { materializeDueRules } from "@/server/services/recurring/materialize";
import { getDashboard } from "@/server/services/reports/dashboard";
import { calendarDateSchema } from "@/shared/contracts/common";
import { todayIn } from "@/shared/dates";

export const runtime = "nodejs";

const paramsSchema = z.object({
  spaceId: z.string().min(1),
  month: calendarDateSchema.optional(),
});
type Params = z.infer<typeof paramsSchema>;

/**
 * GET /api/v1/spaces/:spaceId/dashboard
 *
 * Patrimonio neto, saldo por cuenta, ingresos vs egresos del mes (con el mes
 * anterior para comparar) y top de categorías. En Spaces compartidos suma el
 * desglose por miembro.
 *
 * El mes por defecto es el actual en la timezone de QUIEN MIRA, no la del
 * servidor: el 1 de mes a las 00:30 en Madrid, un server en UTC mostraría
 * todavía el mes anterior.
 */
export const GET = route<undefined, Params>(
  { params: paramsSchema, space: { minRole: "VIEWER" } },
  async ({ params, access, session, db, logger }) => {
    /**
     * Barrido oportunista de reglas programadas ANTES de armar la respuesta:
     * el movimiento que vencía hoy tiene que estar en "por confirmar" al abrir
     * la app, haya cron configurado o no. Es idempotente contra el cron (el
     * unique parcial descarta duplicados) y cuando no hay nada vencido cuesta
     * una sola consulta indexada.
     *
     * Si falla no rompe el dashboard: el inicio con números vale más que el
     * barrido, y la corrida siguiente (o el cron) recupera lo pendiente.
     */
    try {
      await materializeDueRules({
        spaceId: access.spaceId,
        until: todayIn(session.timezone),
        logger,
      });
    } catch (error) {
      logger.warn(
        {
          spaceId: access.spaceId,
          err: error instanceof Error ? error.message : "desconocido",
        },
        "falló el barrido de recurrentes al abrir el dashboard",
      );
    }

    const space = await systemClient().space.findUniqueOrThrow({
      where: { id: access.spaceId },
      select: { primaryCurrency: true, timezone: true },
    });

    return json(await getDashboard(db, space, session.timezone, params.month));
  },
);
