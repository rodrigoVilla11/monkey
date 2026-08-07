import { z } from "zod";

import { route } from "@/server/api/handler";
import { json, noContent } from "@/server/api/responses";
import { systemClient } from "@/server/db/system";
import {
  deleteTransfer,
  getTransfer,
  updateTransfer,
} from "@/server/services/transfers";
import {
  updateTransferRequestSchema,
  type UpdateTransferRequest,
} from "@/shared/contracts/transfers";

export const runtime = "nodejs";

const paramsSchema = z.object({
  spaceId: z.string().min(1),
  transferGroupId: z.string().min(1),
});
type Params = z.infer<typeof paramsSchema>;

const primaryCurrencyOf = async (spaceId: string): Promise<string> => {
  const space = await systemClient().space.findUniqueOrThrow({
    where: { id: spaceId },
    select: { primaryCurrency: true },
  });
  return space.primaryCurrency;
};

export const GET = route<undefined, Params>(
  { params: paramsSchema, space: { minRole: "VIEWER" } },
  async ({ params, access, db }) =>
    json({
      transfer: await getTransfer(
        db,
        await primaryCurrencyOf(access.spaceId),
        params.transferGroupId,
      ),
    }),
);

/**
 * PATCH — reemplaza la transferencia entera. MEMBER o superior.
 *
 * No existe editar una pata: el endpoint de transacciones rechaza cualquier
 * movimiento con `transferGroupId` justamente para que la única vía sea esta,
 * donde las dos patas se recalculan juntas.
 */
export const PATCH = route<UpdateTransferRequest, Params>(
  {
    body: updateTransferRequestSchema,
    params: paramsSchema,
    space: { minRole: "MEMBER" },
  },
  async ({ body, params, access, db }) => {
    const primaryCurrency = await primaryCurrencyOf(access.spaceId);

    await systemClient().$transaction(async (tx) => {
      await updateTransfer(
        db,
        tx,
        { spaceId: access.spaceId, primaryCurrency },
        params.transferGroupId,
        body,
      );
    });

    return json({
      transfer: await getTransfer(db, primaryCurrency, params.transferGroupId),
    });
  },
);

export const DELETE = route<undefined, Params>(
  { params: paramsSchema, space: { minRole: "MEMBER" } },
  async ({ params, db }) => {
    await systemClient().$transaction(async (tx) => {
      await deleteTransfer(db, tx, params.transferGroupId);
    });
    return noContent();
  },
);
