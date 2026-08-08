import { z } from "zod";

import { route } from "@/server/api/handler";
import { noContent } from "@/server/api/responses";
import { systemClient } from "@/server/db/system";
import { deleteSettlement } from "@/server/services/splits";

export const runtime = "nodejs";

const paramsSchema = z.object({
  spaceId: z.string().min(1),
  settlementId: z.string().min(1),
});
type Params = z.infer<typeof paramsSchema>;

/**
 * DELETE — deshace un saldado. MEMBER o superior.
 *
 * Borrado real: un saldado que no ocurrió no debería dejar rastro, y quitarlo
 * devuelve el saldo entre las dos personas a lo que era.
 */
export const DELETE = route<undefined, Params>(
  { params: paramsSchema, space: { minRole: "MEMBER" } },
  async ({ params, db }) => {
    await systemClient().$transaction(async (tx) => {
      await deleteSettlement(db, tx, params.settlementId);
    });
    return noContent();
  },
);
