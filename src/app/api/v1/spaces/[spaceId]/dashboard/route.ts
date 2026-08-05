import { z } from "zod";

import { route } from "@/server/api/handler";
import { json } from "@/server/api/responses";
import { systemClient } from "@/server/db/system";
import { getDashboard } from "@/server/services/reports/dashboard";
import { calendarDateSchema } from "@/shared/contracts/common";

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
  async ({ params, access, session, db }) => {
    const space = await systemClient().space.findUniqueOrThrow({
      where: { id: access.spaceId },
      select: { primaryCurrency: true, timezone: true },
    });

    return json(await getDashboard(db, space, session.timezone, params.month));
  },
);
