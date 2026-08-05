import { z } from "zod";

import { route } from "@/server/api/handler";
import { noContent } from "@/server/api/responses";
import { transferOwnership } from "@/server/services/spaces/members";
import {
  transferOwnershipRequestSchema,
  type TransferOwnershipRequest,
} from "@/shared/contracts/spaces";

export const runtime = "nodejs";

const paramsSchema = z.object({ spaceId: z.string().min(1) });
type Params = z.infer<typeof paramsSchema>;

/**
 * POST /api/v1/spaces/:spaceId/transfer-ownership
 *
 * Solo OWNER. Quien transfiere queda como ADMIN — sigue gestionando todo salvo
 * eliminar el Space.
 *
 * Se hace en una transacción de dos pasos (degradar, después promover) porque
 * hay un índice único parcial que impide dos OWNER a la vez, aunque sea por un
 * instante.
 */
export const POST = route<TransferOwnershipRequest, Params>(
  {
    body: transferOwnershipRequestSchema,
    params: paramsSchema,
    space: { minRole: "OWNER" },
  },
  async ({ body, access, session, logger }) => {
    await transferOwnership(
      access.spaceId,
      { userId: access.userId, name: session.name, role: access.role },
      body.userId,
    );
    logger.warn({ newOwnerId: body.userId }, "propiedad transferida");
    return noContent();
  },
);
