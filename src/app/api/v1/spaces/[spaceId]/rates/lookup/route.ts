import { z } from "zod";

import { route } from "@/server/api/handler";
import { json } from "@/server/api/responses";
import { systemClient } from "@/server/db/system";
import { lookupRate } from "@/server/services/rates/manage";
import { rateLookupQuerySchema } from "@/shared/contracts/rates";

export const runtime = "nodejs";

const paramsSchema = z
  .object({ spaceId: z.string().min(1) })
  .and(rateLookupQuerySchema);
type Params = z.infer<typeof paramsSchema>;

/**
 * GET /api/v1/spaces/:spaceId/rates/lookup?baseCurrency=&quoteCurrency=&date=
 *
 * La cotización vigente de un par en una fecha, resuelta como la usaría el
 * servidor (directa o inversa, la última cargada hasta ese día). Es lo que le
 * permite a la pantalla de transferencias proponer cuánto entra en la cuenta
 * de destino antes de guardar.
 *
 * Segmento estático `lookup` junto al dinámico `[rateId]`: Next prioriza el
 * estático, así que `/rates/lookup` nunca se interpreta como un id.
 */
export const GET = route<undefined, Params>(
  { params: paramsSchema, space: { minRole: "VIEWER" } },
  async ({ params, access }) => {
    const space = await systemClient().space.findUniqueOrThrow({
      where: { id: access.spaceId },
      select: { timezone: true },
    });

    return json({ rate: await lookupRate(space.timezone, params) });
  },
);
