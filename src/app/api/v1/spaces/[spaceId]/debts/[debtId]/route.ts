import { z } from "zod";

import { route } from "@/server/api/handler";
import { json, noContent } from "@/server/api/responses";
import { systemClient } from "@/server/db/system";
import { deleteDebt, getDebt, updateDebt } from "@/server/services/debts";
import {
  updateDebtRequestSchema,
  type UpdateDebtRequest,
} from "@/shared/contracts/debts";

export const runtime = "nodejs";

const paramsSchema = z.object({
  spaceId: z.string().min(1),
  debtId: z.string().min(1),
});
type Params = z.infer<typeof paramsSchema>;

const timezoneOf = async (spaceId: string): Promise<string> => {
  const space = await systemClient().space.findUniqueOrThrow({
    where: { id: spaceId },
    select: { timezone: true },
  });
  return space.timezone;
};

/** GET — la deuda con su historial de pagos. */
export const GET = route<undefined, Params>(
  { params: paramsSchema, space: { minRole: "VIEWER" } },
  async ({ params, access, db }) =>
    json({
      debt: await getDebt(db, await timezoneOf(access.spaceId), params.debtId),
    }),
);

export const PATCH = route<UpdateDebtRequest, Params>(
  {
    body: updateDebtRequestSchema,
    params: paramsSchema,
    space: { minRole: "MEMBER" },
  },
  async ({ body, params, access, db }) => {
    await systemClient().$transaction(async (tx) => {
      await updateDebt(db, tx, access.spaceId, params.debtId, body);
    });

    return json({
      debt: await getDebt(db, await timezoneOf(access.spaceId), params.debtId),
    });
  },
);

/**
 * DELETE — borrado lógico de la deuda y de sus pagos.
 *
 * Los movimientos vinculados NO se tocan: son plata que salió de verdad. Borrar
 * la deuda es dejar de seguirla, no deshacer lo que se pagó.
 */
export const DELETE = route<undefined, Params>(
  { params: paramsSchema, space: { minRole: "MEMBER" } },
  async ({ params, db }) => {
    await systemClient().$transaction(async (tx) => {
      await deleteDebt(db, tx, params.debtId);
    });
    return noContent();
  },
);
