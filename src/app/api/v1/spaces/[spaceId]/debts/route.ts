import { z } from "zod";

import { route } from "@/server/api/handler";
import { json } from "@/server/api/responses";
import { systemClient } from "@/server/db/system";
import { createDebt, getDebt, listDebts } from "@/server/services/debts";
import {
  createDebtRequestSchema,
  debtFiltersSchema,
  type CreateDebtRequest,
} from "@/shared/contracts/debts";

export const runtime = "nodejs";

const paramsSchema = z
  .object({ spaceId: z.string().min(1) })
  .and(debtFiltersSchema);
type Params = z.infer<typeof paramsSchema>;

export const GET = route<undefined, Params>(
  { params: paramsSchema, space: { minRole: "VIEWER" } },
  async ({ params, access, db }) => {
    const space = await systemClient().space.findUniqueOrThrow({
      where: { id: access.spaceId },
      select: { timezone: true },
    });

    return json({ debts: await listDebts(db, space.timezone, params) });
  },
);

export const POST = route<CreateDebtRequest, Params>(
  {
    body: createDebtRequestSchema,
    params: paramsSchema,
    space: { minRole: "MEMBER" },
  },
  async ({ body, access, session, db, logger }) => {
    const space = await systemClient().space.findUniqueOrThrow({
      where: { id: access.spaceId },
      select: { primaryCurrency: true, timezone: true },
    });

    const id = await systemClient().$transaction(async (tx) =>
      createDebt(
        db,
        tx,
        { spaceId: access.spaceId, primaryCurrency: space.primaryCurrency },
        // Quién anota: si pide el movimiento del desembolso, la transacción
        // nace con su autor, como cualquier otra.
        { userId: access.userId, name: session.name },
        body,
      ),
    );

    // Sin importes ni contraparte: en el log no van datos financieros.
    logger.info({ debtId: id, direction: body.direction }, "deuda registrada");

    return json(
      { debt: await getDebt(db, space.timezone, id) },
      { status: 201 },
    );
  },
);
