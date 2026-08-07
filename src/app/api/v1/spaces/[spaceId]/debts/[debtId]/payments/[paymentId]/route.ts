import { z } from "zod";

import { route } from "@/server/api/handler";
import { noContent } from "@/server/api/responses";
import { systemClient } from "@/server/db/system";
import { removePayment } from "@/server/services/debts";

export const runtime = "nodejs";

const paramsSchema = z.object({
  spaceId: z.string().min(1),
  debtId: z.string().min(1),
  paymentId: z.string().min(1),
});
type Params = z.infer<typeof paramsSchema>;

/**
 * DELETE — quita un pago de la deuda.
 *
 * Borrado real y no lógico: un pago no es un hecho económico, es una anotación
 * sobre uno. El movimiento vinculado, si lo hay, queda intacto — lo que se
 * deshace es la imputación, no la transferencia.
 */
export const DELETE = route<undefined, Params>(
  { params: paramsSchema, space: { minRole: "MEMBER" } },
  async ({ params, access, db }) => {
    await systemClient().$transaction(async (tx) => {
      await removePayment(
        db,
        tx,
        access.spaceId,
        params.debtId,
        params.paymentId,
      );
    });
    return noContent();
  },
);
