import { z } from "zod";

import { route } from "@/server/api/handler";
import { json } from "@/server/api/responses";
import { systemClient } from "@/server/db/system";
import { monthlyReport } from "@/server/services/reports";
import { monthlyReportQuerySchema } from "@/shared/contracts/reports-v2";

export const runtime = "nodejs";

const paramsSchema = z
  .object({ spaceId: z.string().min(1) })
  .and(monthlyReportQuerySchema);
type Params = z.infer<typeof paramsSchema>;

/**
 * GET /api/v1/spaces/:spaceId/reports/monthly?months=12
 *
 * Evolución mensual y cash flow en una sola respuesta: son la misma serie
 * vista de dos formas —barras de ingresos/egresos y curva de patrimonio
 * acumulado— y pedirlas por separado sería duplicar la consulta pesada.
 *
 * Las etiquetas de los meses vienen formateadas en el locale de quien
 * pregunta: es el servidor el que sabe qué rango pidió y en qué idioma.
 */
export const GET = route<undefined, Params>(
  { params: paramsSchema, space: { minRole: "VIEWER" } },
  async ({ params, access, session }) => {
    const space = await systemClient().space.findUniqueOrThrow({
      where: { id: access.spaceId },
      select: { primaryCurrency: true },
    });

    return json(
      await monthlyReport(
        { spaceId: access.spaceId, primaryCurrency: space.primaryCurrency },
        session.locale,
        session.timezone,
        params.months,
      ),
    );
  },
);
