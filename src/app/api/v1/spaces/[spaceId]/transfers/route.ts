import { z } from "zod";

import { route } from "@/server/api/handler";
import { json } from "@/server/api/responses";
import { systemClient } from "@/server/db/system";
import { createTransfer, getTransfer } from "@/server/services/transfers";
import {
  createTransferRequestSchema,
  type CreateTransferRequest,
} from "@/shared/contracts/transfers";

export const runtime = "nodejs";

const paramsSchema = z.object({ spaceId: z.string().min(1) });
type Params = z.infer<typeof paramsSchema>;

/**
 * POST — crea una transferencia. MEMBER o superior.
 *
 * Las dos patas se escriben dentro de una transacción de base: si falla la
 * segunda, la primera no queda cargada. Media transferencia es un saldo mal en
 * dos cuentas a la vez.
 *
 * No hay GET de listado: las transferencias aparecen en el listado de
 * movimientos con `?type=TRANSFER`, que ya tiene filtros, cursor y contraparte.
 */
export const POST = route<CreateTransferRequest, Params>(
  {
    body: createTransferRequestSchema,
    params: paramsSchema,
    space: { minRole: "MEMBER" },
  },
  async ({ body, access, session, db, logger }) => {
    const space = await systemClient().space.findUniqueOrThrow({
      where: { id: access.spaceId },
      select: { primaryCurrency: true },
    });

    const transferGroupId = await systemClient().$transaction(async (tx) =>
      createTransfer(
        db,
        tx,
        { spaceId: access.spaceId, primaryCurrency: space.primaryCurrency },
        {
          userId: access.userId,
          name: session.name,
          timezone: session.timezone,
        },
        body,
      ),
    );

    logger.info({ transferGroupId }, "transferencia creada");

    return json(
      {
        transfer: await getTransfer(db, space.primaryCurrency, transferGroupId),
      },
      { status: 201 },
    );
  },
);
