import { z } from "zod";

import { route } from "@/server/api/handler";
import { json, noContent } from "@/server/api/responses";
import {
  deleteBudget,
  getBudget,
  updateBudget,
} from "@/server/services/budgets";
import {
  updateBudgetRequestSchema,
  type UpdateBudgetRequest,
} from "@/shared/contracts/budgets";

export const runtime = "nodejs";

const paramsSchema = z.object({
  spaceId: z.string().min(1),
  budgetId: z.string().min(1),
});
type Params = z.infer<typeof paramsSchema>;

export const GET = route<undefined, Params>(
  { params: paramsSchema, space: { minRole: "VIEWER" } },
  async ({ params, session, db }) =>
    json({ budget: await getBudget(db, session.timezone, params.budgetId) }),
);

export const PATCH = route<UpdateBudgetRequest, Params>(
  {
    body: updateBudgetRequestSchema,
    params: paramsSchema,
    space: { minRole: "MEMBER" },
  },
  async ({ body, params, session, db }) =>
    json({
      budget: await updateBudget(db, session.timezone, params.budgetId, body),
    }),
);

/**
 * DELETE — borrado lógico. MEMBER alcanza: a diferencia de borrar una cuenta,
 * esto no toca ningún movimiento. Un presupuesto es una vista sobre los
 * gastos, no un dato de los gastos.
 */
export const DELETE = route<undefined, Params>(
  { params: paramsSchema, space: { minRole: "MEMBER" } },
  async ({ params, db }) => {
    await deleteBudget(db, params.budgetId);
    return noContent();
  },
);
