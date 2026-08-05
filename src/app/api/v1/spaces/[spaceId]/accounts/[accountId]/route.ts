import { z } from "zod";

import { route } from "@/server/api/handler";
import { json, noContent } from "@/server/api/responses";
import { systemClient } from "@/server/db/system";
import {
  deleteAccount,
  getAccount,
  updateAccount,
} from "@/server/services/accounts";
import {
  updateAccountRequestSchema,
  type UpdateAccountRequest,
} from "@/shared/contracts/accounts";

export const runtime = "nodejs";

const paramsSchema = z.object({
  spaceId: z.string().min(1),
  accountId: z.string().min(1),
});
type Params = z.infer<typeof paramsSchema>;

export const GET = route<undefined, Params>(
  { params: paramsSchema, space: { minRole: "VIEWER" } },
  async ({ params, db }) =>
    json({ account: await getAccount(db, params.accountId) }),
);

export const PATCH = route<UpdateAccountRequest, Params>(
  {
    body: updateAccountRequestSchema,
    params: paramsSchema,
    space: { minRole: "MEMBER" },
  },
  async ({ body, params, db }) =>
    json({ account: await updateAccount(db, params.accountId, body) }),
);

/**
 * DELETE — ADMIN, y solo si la cuenta no tiene movimientos.
 *
 * Es destructivo y queda auditado. Con movimientos se responde 409 sugiriendo
 * archivar: borrarla dejaría transacciones apuntando a una cuenta invisible y
 * los reportes históricos dejarían de cuadrar.
 */
export const DELETE = route<undefined, Params>(
  { params: paramsSchema, space: { minRole: "ADMIN" } },
  async ({ params, access, session, db, logger }) => {
    await systemClient().$transaction(async (tx) => {
      await deleteAccount(db, tx, access.spaceId, params.accountId, {
        userId: access.userId,
        name: session.name,
      });
    });

    logger.warn({ accountId: params.accountId }, "cuenta eliminada");
    return noContent();
  },
);
