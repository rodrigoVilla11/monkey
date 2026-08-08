import { z } from "zod";

import { route } from "@/server/api/handler";
import { json } from "@/server/api/responses";
import { systemClient } from "@/server/db/system";
import { createRate, listRates } from "@/server/services/rates/manage";
import {
  createRateRequestSchema,
  rateFiltersSchema,
  type CreateRateRequest,
} from "@/shared/contracts/rates";

export const runtime = "nodejs";

const paramsSchema = z
  .object({ spaceId: z.string().min(1) })
  .and(rateFiltersSchema);
type Params = z.infer<typeof paramsSchema>;

const spaceOf = async (spaceId: string) =>
  systemClient().space.findUniqueOrThrow({
    where: { id: spaceId },
    select: { primaryCurrency: true, timezone: true },
  });

/**
 * GET — las cotizaciones cargadas y, sobre todo, las que FALTAN.
 *
 * Lo segundo es lo que hace útil la pantalla: dice exactamente qué pares
 * necesita este Space para que su inicio deje de decir "no se pudo convertir",
 * mirando las monedas de sus cuentas. Sin eso sería un formulario a ciegas.
 */
export const GET = route<undefined, Params>(
  { params: paramsSchema, space: { minRole: "VIEWER" } },
  async ({ params, access, db }) =>
    json(await listRates(db, await spaceOf(access.spaceId), params)),
);

/**
 * POST — carga una cotización. MEMBER o superior.
 *
 * Ojo con el alcance: `ExchangeRate` es la única tabla sin `spaceId`, así que
 * lo que se carga acá lo ven TODOS los Spaces de la instalación. En una
 * instalación personal o de una pareja es lo que uno quiere; con desconocidos
 * no lo sería.
 */
export const POST = route<CreateRateRequest, Params>(
  {
    body: createRateRequestSchema,
    params: paramsSchema,
    space: { minRole: "MEMBER" },
  },
  async ({ body, access, logger }) => {
    const space = await spaceOf(access.spaceId);

    const rate = await systemClient().$transaction(async (tx) =>
      createRate(tx, space.timezone, body),
    );

    logger.info(
      { base: body.baseCurrency, quote: body.quoteCurrency },
      "cotización cargada",
    );

    return json({ rate }, { status: 201 });
  },
);
