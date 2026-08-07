import { z } from "zod";

import { route } from "@/server/api/handler";
import { json, noContent } from "@/server/api/responses";
import { systemClient } from "@/server/db/system";
import {
  deleteSavingsGoal,
  getSavingsGoal,
  updateSavingsGoal,
} from "@/server/services/savings";
import {
  updateSavingsGoalRequestSchema,
  type UpdateSavingsGoalRequest,
} from "@/shared/contracts/savings";

export const runtime = "nodejs";

const paramsSchema = z.object({
  spaceId: z.string().min(1),
  goalId: z.string().min(1),
});
type Params = z.infer<typeof paramsSchema>;

const timezoneOf = async (spaceId: string): Promise<string> => {
  const space = await systemClient().space.findUniqueOrThrow({
    where: { id: spaceId },
    select: { timezone: true },
  });
  return space.timezone;
};

/** GET — la meta con su historial de aportes. */
export const GET = route<undefined, Params>(
  { params: paramsSchema, space: { minRole: "VIEWER" } },
  async ({ params, access, db }) =>
    json({
      goal: await getSavingsGoal(
        db,
        await timezoneOf(access.spaceId),
        params.goalId,
      ),
    }),
);

export const PATCH = route<UpdateSavingsGoalRequest, Params>(
  {
    body: updateSavingsGoalRequestSchema,
    params: paramsSchema,
    space: { minRole: "MEMBER" },
  },
  async ({ body, params, access, db }) => {
    await systemClient().$transaction(async (tx) => {
      await updateSavingsGoal(db, tx, access.spaceId, params.goalId, body);
    });

    return json({
      goal: await getSavingsGoal(
        db,
        await timezoneOf(access.spaceId),
        params.goalId,
      ),
    });
  },
);

/**
 * DELETE — borrado lógico de la meta y de sus aportes.
 *
 * Los movimientos vinculados NO se tocan: son transferencias reales que ya
 * movieron saldos. Borrar la meta es dejar de seguir un objetivo, no deshacer
 * lo que se ahorró.
 */
export const DELETE = route<undefined, Params>(
  { params: paramsSchema, space: { minRole: "MEMBER" } },
  async ({ params, db }) => {
    await systemClient().$transaction(async (tx) => {
      await deleteSavingsGoal(db, tx, params.goalId);
    });
    return noContent();
  },
);
