import { z } from "zod";

import { route } from "@/server/api/handler";
import { json, noContent } from "@/server/api/responses";
import { systemClient } from "@/server/db/system";
import { clearSplit, getSplit, setSplit } from "@/server/services/splits";
import {
  setSplitRequestSchema,
  type SetSplitRequest,
} from "@/shared/contracts/splits";

export const runtime = "nodejs";

const paramsSchema = z.object({
  spaceId: z.string().min(1),
  transactionId: z.string().min(1),
});
type Params = z.infer<typeof paramsSchema>;

const spaceContext = async (spaceId: string) => {
  const space = await systemClient().space.findUniqueOrThrow({
    where: { id: spaceId },
    select: { primaryCurrency: true, timezone: true },
  });
  return { spaceId, ...space };
};

export const GET = route<undefined, Params>(
  { params: paramsSchema, space: { minRole: "VIEWER" } },
  async ({ params, db }) =>
    json({ split: await getSplit(db, params.transactionId) }),
);

/**
 * PUT — reparte el gasto. MEMBER o superior.
 *
 * Es PUT y no PATCH porque reemplaza el reparto ENTERO: mandar una lista
 * parcial y que el servidor complete el resto sería la forma más fácil de que
 * las partes dejen de sumar el importe, que es la única invariante del módulo.
 *
 * No crea ningún movimiento: el gasto ya está cargado, esto solo anota de quién
 * era cada parte.
 */
export const PUT = route<SetSplitRequest, Params>(
  {
    body: setSplitRequestSchema,
    params: paramsSchema,
    space: { minRole: "MEMBER" },
  },
  async ({ body, params, access, db, logger }) => {
    const space = await spaceContext(access.spaceId);

    await systemClient().$transaction(async (tx) => {
      await setSplit(db, tx, space, params.transactionId, body);
    });

    // Sin importes: en el log no van datos financieros.
    logger.info(
      {
        transactionId: params.transactionId,
        mode: body.mode,
        participants: body.participants.length,
      },
      "gasto repartido",
    );

    return json({ split: await getSplit(db, params.transactionId) });
  },
);

/** DELETE — quita el reparto. El gasto queda como estaba. */
export const DELETE = route<undefined, Params>(
  { params: paramsSchema, space: { minRole: "MEMBER" } },
  async ({ params, access, db }) => {
    await systemClient().$transaction(async (tx) => {
      await clearSplit(db, tx, access.spaceId, params.transactionId);
    });
    return noContent();
  },
);
