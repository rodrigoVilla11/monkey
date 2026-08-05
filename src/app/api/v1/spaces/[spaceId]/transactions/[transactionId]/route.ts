import { z } from "zod";

import { route } from "@/server/api/handler";
import { json, noContent } from "@/server/api/responses";
import { systemClient } from "@/server/db/system";
import {
  deleteTransaction,
  getTransaction,
  updateTransaction,
} from "@/server/services/transactions";
import {
  updateTransactionRequestSchema,
  type UpdateTransactionRequest,
} from "@/shared/contracts/transactions";

export const runtime = "nodejs";

const paramsSchema = z.object({
  spaceId: z.string().min(1),
  transactionId: z.string().min(1),
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
      transaction: await getTransaction(
        db,
        await primaryCurrencyOf(access.spaceId),
        params.transactionId,
      ),
    }),
);

/**
 * PATCH — MEMBER o superior.
 *
 * Cualquier miembro con permiso de escritura puede editar un movimiento, no
 * solo quien lo cargó: en un espacio compartido corregir el gasto del otro es
 * el caso normal, y el audit log guarda quién lo hizo.
 */
export const PATCH = route<UpdateTransactionRequest, Params>(
  {
    body: updateTransactionRequestSchema,
    params: paramsSchema,
    space: { minRole: "MEMBER" },
  },
  async ({ body, params, access, db }) => {
    const primaryCurrency = await primaryCurrencyOf(access.spaceId);

    await systemClient().$transaction(async (tx) => {
      await updateTransaction(
        db,
        tx,
        { spaceId: access.spaceId, primaryCurrency, timezone: "UTC" },
        params.transactionId,
        body,
      );
    });

    return json({
      transaction: await getTransaction(
        db,
        primaryCurrency,
        params.transactionId,
      ),
    });
  },
);

export const DELETE = route<undefined, Params>(
  { params: paramsSchema, space: { minRole: "MEMBER" } },
  async ({ params, db }) => {
    await systemClient().$transaction(async (tx) => {
      await deleteTransaction(db, tx, params.transactionId);
    });
    return noContent();
  },
);
