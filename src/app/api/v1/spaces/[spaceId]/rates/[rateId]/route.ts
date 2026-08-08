import { z } from "zod";

import { route } from "@/server/api/handler";
import { noContent } from "@/server/api/responses";
import { systemClient } from "@/server/db/system";
import { deleteRate } from "@/server/services/rates/manage";

export const runtime = "nodejs";

const paramsSchema = z.object({
  spaceId: z.string().min(1),
  rateId: z.string().min(1),
});
type Params = z.infer<typeof paramsSchema>;

/**
 * DELETE — quita una cotización. MEMBER o superior.
 *
 * Borrado real: una cotización mal cargada no debería dejar rastro. Los
 * movimientos que ya la usaron no se ven afectados — cada uno guarda la suya
 * congelada al crearse, justamente para que borrar o corregir una cotización no
 * reescriba el pasado.
 */
export const DELETE = route<undefined, Params>(
  { params: paramsSchema, space: { minRole: "MEMBER" } },
  async ({ params, db }) => {
    await systemClient().$transaction(async (tx) => {
      await deleteRate(db, tx, params.rateId);
    });
    return noContent();
  },
);
