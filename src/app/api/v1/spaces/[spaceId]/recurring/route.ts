import { z } from "zod";

import { route } from "@/server/api/handler";
import { json } from "@/server/api/responses";
import { systemClient } from "@/server/db/system";
import {
  createRecurringRule,
  getRecurringRule,
  listRecurringRules,
} from "@/server/services/recurring";
import {
  createRecurringRuleRequestSchema,
  recurringRuleFiltersSchema,
  type CreateRecurringRuleRequest,
} from "@/shared/contracts/recurring";

export const runtime = "nodejs";

const paramsSchema = z
  .object({ spaceId: z.string().min(1) })
  .and(recurringRuleFiltersSchema);
type Params = z.infer<typeof paramsSchema>;

export const GET = route<undefined, Params>(
  { params: paramsSchema, space: { minRole: "VIEWER" } },
  async ({ params, db }) =>
    json({ rules: await listRecurringRules(db, params) }),
);

/**
 * POST — programa un movimiento recurrente. MEMBER o superior.
 *
 * No materializa nada acá: eso lo hace el job. Una regla con `startDate` en el
 * pasado queda con ocurrencias vencidas que la próxima corrida rellena, que es
 * la forma de cargar el historial de algo que se venía pagando.
 */
export const POST = route<CreateRecurringRuleRequest, Params>(
  {
    body: createRecurringRuleRequestSchema,
    params: paramsSchema,
    space: { minRole: "MEMBER" },
  },
  async ({ body, access, session, db, logger }) => {
    const id = await systemClient().$transaction(async (tx) =>
      createRecurringRule(
        db,
        tx,
        { spaceId: access.spaceId },
        { userId: access.userId, name: session.name },
        body,
      ),
    );

    logger.info(
      { recurringRuleId: id, frequency: body.frequency },
      "regla recurrente creada",
    );

    return json({ rule: await getRecurringRule(db, id) }, { status: 201 });
  },
);
