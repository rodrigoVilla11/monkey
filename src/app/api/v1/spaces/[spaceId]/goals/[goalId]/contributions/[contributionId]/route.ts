import { z } from "zod";

import { route } from "@/server/api/handler";
import { noContent } from "@/server/api/responses";
import { systemClient } from "@/server/db/system";
import { removeContribution } from "@/server/services/savings";

export const runtime = "nodejs";

const paramsSchema = z.object({
  spaceId: z.string().min(1),
  goalId: z.string().min(1),
  contributionId: z.string().min(1),
});
type Params = z.infer<typeof paramsSchema>;

/**
 * DELETE — quita un aporte de la meta.
 *
 * Borrado real y no lógico: un aporte no es un hecho económico, es una
 * anotación sobre uno. El movimiento vinculado, si lo hay, queda intacto —lo
 * que se deshace es la etiqueta, no la transferencia.
 */
export const DELETE = route<undefined, Params>(
  { params: paramsSchema, space: { minRole: "MEMBER" } },
  async ({ params, access, db }) => {
    await systemClient().$transaction(async (tx) => {
      await removeContribution(
        db,
        tx,
        access.spaceId,
        params.goalId,
        params.contributionId,
      );
    });
    return noContent();
  },
);
