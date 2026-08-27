import { z } from "zod";

import { route } from "@/server/api/handler";
import { json, noContent } from "@/server/api/responses";
import { systemClient } from "@/server/db/system";
import {
  getSavingsGoal,
  removeContribution,
  updateContribution,
} from "@/server/services/savings";
import {
  updateContributionRequestSchema,
  type UpdateContributionRequest,
} from "@/shared/contracts/savings";

export const runtime = "nodejs";

const paramsSchema = z.object({
  spaceId: z.string().min(1),
  goalId: z.string().min(1),
  contributionId: z.string().min(1),
});
type Params = z.infer<typeof paramsSchema>;

/**
 * PATCH — corrige un aporte: importe, fecha o nota.
 *
 * En un aporte vinculado a un movimiento solo se edita la nota; el importe y
 * la fecha salen del movimiento y el servicio rechaza tocarlos.
 *
 * Devuelve la meta entera, como el POST: quien corrigió un importe quiere ver
 * la barra recalculada, no el recibo.
 */
export const PATCH = route<UpdateContributionRequest, Params>(
  {
    body: updateContributionRequestSchema,
    params: paramsSchema,
    space: { minRole: "MEMBER" },
  },
  async ({ body, params, access, db }) => {
    await systemClient().$transaction(async (tx) => {
      await updateContribution(
        db,
        tx,
        access.spaceId,
        params.goalId,
        params.contributionId,
        body,
      );
    });

    const space = await systemClient().space.findUniqueOrThrow({
      where: { id: access.spaceId },
      select: { timezone: true },
    });

    return json({
      goal: await getSavingsGoal(db, space.timezone, params.goalId),
    });
  },
);

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
