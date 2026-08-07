import { z } from "zod";

import { route } from "@/server/api/handler";
import { json, noContent } from "@/server/api/responses";
import { systemClient } from "@/server/db/system";
import {
  deleteRecurringRule,
  getRecurringRule,
  updateRecurringRule,
} from "@/server/services/recurring";
import {
  updateRecurringRuleRequestSchema,
  type UpdateRecurringRuleRequest,
} from "@/shared/contracts/recurring";

export const runtime = "nodejs";

const paramsSchema = z.object({
  spaceId: z.string().min(1),
  ruleId: z.string().min(1),
});
type Params = z.infer<typeof paramsSchema>;

export const GET = route<undefined, Params>(
  { params: paramsSchema, space: { minRole: "VIEWER" } },
  async ({ params, db }) =>
    json({ rule: await getRecurringRule(db, params.ruleId) }),
);

/**
 * PATCH — MEMBER o superior.
 *
 * Cambiar el patrón reancla la serie hacia adelante. Lo que ya se materializó
 * no se toca: son movimientos reales que ya afectaron los saldos.
 */
export const PATCH = route<UpdateRecurringRuleRequest, Params>(
  {
    body: updateRecurringRuleRequestSchema,
    params: paramsSchema,
    space: { minRole: "MEMBER" },
  },
  async ({ body, params, db }) => {
    await systemClient().$transaction(async (tx) => {
      await updateRecurringRule(db, tx, params.ruleId, body);
    });

    return json({ rule: await getRecurringRule(db, params.ruleId) });
  },
);

/**
 * DELETE — borrado lógico de la regla.
 *
 * Las transacciones que ya generó se quedan: son gastos que ocurrieron.
 */
export const DELETE = route<undefined, Params>(
  { params: paramsSchema, space: { minRole: "MEMBER" } },
  async ({ params, db }) => {
    await systemClient().$transaction(async (tx) => {
      await deleteRecurringRule(db, tx, params.ruleId);
    });
    return noContent();
  },
);
