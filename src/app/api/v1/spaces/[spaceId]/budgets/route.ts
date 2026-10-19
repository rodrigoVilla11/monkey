import { z } from "zod";

import { route } from "@/server/api/handler";
import { json } from "@/server/api/responses";
import { systemClient } from "@/server/db/system";
import { createBudget, listBudgets } from "@/server/services/budgets";
import {
  createBudgetRequestSchema,
  type CreateBudgetRequest,
} from "@/shared/contracts/budgets";
import { calendarDateSchema } from "@/shared/contracts/common";

export const runtime = "nodejs";

const paramsSchema = z.object({
  spaceId: z.string().min(1),
  includeInactive: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  /** Estado al día indicado en vez de hoy: para mirar un mes ya cerrado. */
  asOf: calendarDateSchema.optional(),
});
type Params = z.infer<typeof paramsSchema>;

/**
 * GET — presupuestos con su estado del período en curso ya calculado (o del
 * período que contenía `asOf`).
 *
 * El estado se resuelve en el servidor y no en el cliente porque necesita
 * agregar los gastos del período, que es una consulta, no un cálculo.
 */
export const GET = route<undefined, Params>(
  { params: paramsSchema, space: { minRole: "VIEWER" } },
  async ({ params, session, db }) =>
    json({
      budgets: await listBudgets(db, session.timezone, {
        includeInactive: params.includeInactive,
        asOf: params.asOf,
      }),
    }),
);

/** POST — MEMBER o superior. */
export const POST = route<CreateBudgetRequest, Params>(
  {
    body: createBudgetRequestSchema,
    params: paramsSchema,
    space: { minRole: "MEMBER" },
  },
  async ({ body, access, session, db }) => {
    const space = await systemClient().space.findUniqueOrThrow({
      where: { id: access.spaceId },
      select: { primaryCurrency: true },
    });

    const budget = await createBudget(
      db,
      access.spaceId,
      space.primaryCurrency,
      session.timezone,
      body,
    );

    return json({ budget }, { status: 201 });
  },
);
