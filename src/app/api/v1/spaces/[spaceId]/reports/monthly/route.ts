import { z } from "zod";

import { route } from "@/server/api/handler";
import { json } from "@/server/api/responses";
import { systemClient } from "@/server/db/system";
import { seriesReport } from "@/server/services/reports";
import { seriesReportQuerySchema } from "@/shared/contracts/reports-v2";
import { todayIn } from "@/shared/dates";
import { lastMonthsRange, rangeFromQuery } from "@/shared/periods";

export const runtime = "nodejs";

const paramsSchema = z
  .object({ spaceId: z.string().min(1) })
  .and(seriesReportQuerySchema);
type Params = z.infer<typeof paramsSchema>;

/**
 * GET /api/v1/spaces/:spaceId/reports/monthly?from=&to=&granularity=
 * GET /api/v1/spaces/:spaceId/reports/monthly?months=12
 *
 * Evolución y cash flow en una sola respuesta: son la misma serie vista de
 * dos formas —barras de ingresos/egresos y curva de patrimonio acumulado— y
 * pedirlas por separado sería duplicar la consulta pesada.
 *
 * Con rango, el corte lo decide el largo salvo que se pida uno: un mes se ve
 * por día, unos meses por semana y más por mes. Con `months`, siempre por
 * mes: es la forma original del endpoint y el path conserva el nombre por
 * eso mismo.
 *
 * La semana empieza donde diga la preferencia del usuario y las etiquetas
 * vienen en su locale: todo sale de la sesión, no de la query.
 */
export const GET = route<undefined, Params>(
  { params: paramsSchema, space: { minRole: "VIEWER" } },
  async ({ params, access, session }) => {
    const space = await systemClient().space.findUniqueOrThrow({
      where: { id: access.spaceId },
      select: { primaryCurrency: true },
    });

    const today = todayIn(session.timezone);
    const explicit = params.from !== undefined && params.to !== undefined;
    const range = rangeFromQuery(params, () =>
      lastMonthsRange(today, params.months ?? 12),
    );

    return json(
      await seriesReport(
        { spaceId: access.spaceId, primaryCurrency: space.primaryCurrency },
        session.locale,
        range,
        {
          granularity: explicit ? params.granularity : "month",
          weekStartsOn: session.weekStartsOn,
          today,
        },
      ),
    );
  },
);
