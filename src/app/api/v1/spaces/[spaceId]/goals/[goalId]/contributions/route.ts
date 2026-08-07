import { z } from "zod";

import { route } from "@/server/api/handler";
import { json } from "@/server/api/responses";
import { systemClient } from "@/server/db/system";
import { addContribution, getSavingsGoal } from "@/server/services/savings";
import {
  createContributionRequestSchema,
  type CreateContributionRequest,
} from "@/shared/contracts/savings";

export const runtime = "nodejs";

const paramsSchema = z.object({
  spaceId: z.string().min(1),
  goalId: z.string().min(1),
});
type Params = z.infer<typeof paramsSchema>;

/**
 * POST — registra un aporte. MEMBER o superior.
 *
 * No crea ningún movimiento: ahorrar no es gastar. O se vincula uno que ya
 * existe —la transferencia a la cuenta de ahorro— o es puro registro.
 *
 * Devuelve la meta entera y no solo el aporte: quien acaba de aportar quiere
 * ver la barra nueva, no el recibo.
 */
export const POST = route<CreateContributionRequest, Params>(
  {
    body: createContributionRequestSchema,
    params: paramsSchema,
    space: { minRole: "MEMBER" },
  },
  async ({ body, params, access, db, logger }) => {
    const space = await systemClient().space.findUniqueOrThrow({
      where: { id: access.spaceId },
      select: { primaryCurrency: true, timezone: true },
    });

    const id = await systemClient().$transaction(async (tx) =>
      addContribution(
        db,
        tx,
        { spaceId: access.spaceId, primaryCurrency: space.primaryCurrency },
        params.goalId,
        space.timezone,
        body,
      ),
    );

    // Sin el importe: en el log no van datos financieros.
    logger.info(
      {
        goalId: params.goalId,
        contributionId: id,
        linked: body.transactionId !== undefined,
      },
      "aporte registrado",
    );

    return json(
      { goal: await getSavingsGoal(db, space.timezone, params.goalId) },
      { status: 201 },
    );
  },
);
