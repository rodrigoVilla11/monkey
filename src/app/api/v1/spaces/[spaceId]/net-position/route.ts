import { z } from "zod";

import { route } from "@/server/api/handler";
import { json } from "@/server/api/responses";
import { systemClient } from "@/server/db/system";
import { netPositionOf } from "@/server/services/debts";

export const runtime = "nodejs";

const paramsSchema = z.object({ spaceId: z.string().min(1) });
type Params = z.infer<typeof paramsSchema>;

/**
 * GET — caja + lo que te deben − lo que debés.
 *
 * Vive en su propio endpoint y NO se mete en la curva de patrimonio de los
 * reportes. Esa curva es una posición de CAJA, y meterle deudas redefiniría en
 * silencio lo que significan todos los reportes que ya existen.
 *
 * Que la distinción importa se ve con un préstamo recién recibido: los 10.000 €
 * están en la cuenta, así que el saldo sube, pero la posición neta no se movió.
 * Las dos cifras son ciertas y responden preguntas distintas.
 */
export const GET = route<undefined, Params>(
  { params: paramsSchema, space: { minRole: "VIEWER" } },
  async ({ access, db }) => {
    const space = await systemClient().space.findUniqueOrThrow({
      where: { id: access.spaceId },
      select: { primaryCurrency: true, timezone: true },
    });

    // El timezone decide qué día es "hoy" para buscar la cotización vigente.
    return json({
      position: await netPositionOf(
        db,
        {
          spaceId: access.spaceId,
          primaryCurrency: space.primaryCurrency,
        },
        space.timezone,
      ),
    });
  },
);
