import { z } from "zod";

import { route } from "@/server/api/handler";
import { json } from "@/server/api/responses";
import { systemClient } from "@/server/db/system";
import {
  createSavingsGoal,
  getSavingsGoal,
  listSavingsGoals,
} from "@/server/services/savings";
import {
  createSavingsGoalRequestSchema,
  savingsGoalFiltersSchema,
  type CreateSavingsGoalRequest,
} from "@/shared/contracts/savings";

export const runtime = "nodejs";

const paramsSchema = z
  .object({ spaceId: z.string().min(1) })
  .and(savingsGoalFiltersSchema);
type Params = z.infer<typeof paramsSchema>;

export const GET = route<undefined, Params>(
  { params: paramsSchema, space: { minRole: "VIEWER" } },
  async ({ params, access, db }) => {
    const space = await systemClient().space.findUniqueOrThrow({
      where: { id: access.spaceId },
      select: { timezone: true },
    });

    return json({ goals: await listSavingsGoals(db, space.timezone, params) });
  },
);

export const POST = route<CreateSavingsGoalRequest, Params>(
  {
    body: createSavingsGoalRequestSchema,
    params: paramsSchema,
    space: { minRole: "MEMBER" },
  },
  async ({ body, access, db, logger }) => {
    const space = await systemClient().space.findUniqueOrThrow({
      where: { id: access.spaceId },
      select: { primaryCurrency: true, timezone: true },
    });

    const id = await systemClient().$transaction(async (tx) =>
      createSavingsGoal(
        db,
        tx,
        { spaceId: access.spaceId, primaryCurrency: space.primaryCurrency },
        body,
      ),
    );

    logger.info({ goalId: id }, "meta de ahorro creada");

    return json(
      { goal: await getSavingsGoal(db, space.timezone, id) },
      { status: 201 },
    );
  },
);
