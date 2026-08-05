import { z } from "zod";

import { route } from "@/server/api/handler";
import { json } from "@/server/api/responses";
import { systemClient } from "@/server/db/system";
import { bulkDeleteTransactions } from "@/server/services/transactions";
import {
  bulkDeleteRequestSchema,
  type BulkDeleteRequest,
} from "@/shared/contracts/transactions";

export const runtime = "nodejs";

const paramsSchema = z.object({ spaceId: z.string().min(1) });
type Params = z.infer<typeof paramsSchema>;

/**
 * POST /api/v1/spaces/:spaceId/transactions/bulk-delete
 *
 * ADMIN, no MEMBER: es la operación más destructiva del dominio financiero.
 * Queda auditada con cuántos se pidieron y cuántos se borraron de verdad.
 *
 * Los IDs se filtran por el cliente scopeado, así que los de otro Space
 * simplemente no aparecen y no se borran — sin fallar y sin confirmar que
 * existen.
 */
export const POST = route<BulkDeleteRequest, Params>(
  {
    body: bulkDeleteRequestSchema,
    params: paramsSchema,
    space: { minRole: "ADMIN" },
  },
  async ({ body, access, session, db, logger }) => {
    const deleted = await systemClient().$transaction(async (tx) =>
      bulkDeleteTransactions(db, tx, access.spaceId, body.ids, {
        userId: access.userId,
        name: session.name,
      }),
    );

    logger.warn({ requested: body.ids.length, deleted }, "borrado masivo");
    return json({ deleted });
  },
);
