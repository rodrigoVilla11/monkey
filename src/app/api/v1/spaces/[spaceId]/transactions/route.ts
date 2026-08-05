import { z } from "zod";

import { route } from "@/server/api/handler";
import { json } from "@/server/api/responses";
import { systemClient } from "@/server/db/system";
import {
  createTransaction,
  getTransaction,
  listTransactions,
} from "@/server/services/transactions";
import { cursorPaginationSchema } from "@/shared/contracts/common";
import {
  createTransactionRequestSchema,
  transactionFiltersSchema,
  type CreateTransactionRequest,
} from "@/shared/contracts/transactions";

export const runtime = "nodejs";

const paramsSchema = z
  .object({ spaceId: z.string().min(1) })
  .and(transactionFiltersSchema)
  .and(cursorPaginationSchema);
type Params = z.infer<typeof paramsSchema>;

/**
 * GET — listado con scroll infinito y filtros.
 *
 * Devuelve una página plana ordenada por fecha descendente; el agrupado por
 * día lo hace el cliente, que ya tiene los datos y sabe la timezone de quien
 * mira.
 */
export const GET = route<undefined, Params>(
  { params: paramsSchema, space: { minRole: "VIEWER" } },
  async ({ params, access, db }) => {
    const space = await systemClient().space.findUniqueOrThrow({
      where: { id: access.spaceId },
      select: { primaryCurrency: true },
    });

    const page = await listTransactions(db, space.primaryCurrency, params, {
      cursor: params.cursor,
      limit: params.limit,
    });

    return json(page);
  },
);

/**
 * POST — carga rápida. MEMBER o superior.
 *
 * Todo va dentro de una transacción de base: el movimiento y sus etiquetas.
 * Sin eso, un fallo al vincular una etiqueta dejaría el movimiento cargado a
 * medias.
 */
export const POST = route<CreateTransactionRequest, Params>(
  {
    body: createTransactionRequestSchema,
    params: paramsSchema,
    space: { minRole: "MEMBER" },
  },
  async ({ body, access, session, db, logger }) => {
    const space = await systemClient().space.findUniqueOrThrow({
      where: { id: access.spaceId },
      select: { primaryCurrency: true, timezone: true },
    });

    const id = await systemClient().$transaction(async (tx) =>
      createTransaction(
        db,
        tx,
        {
          spaceId: access.spaceId,
          primaryCurrency: space.primaryCurrency,
          timezone: space.timezone,
        },
        {
          userId: access.userId,
          name: session.name,
          timezone: session.timezone,
        },
        body,
      ),
    );

    logger.info({ transactionId: id, type: body.type }, "movimiento creado");

    return json(
      { transaction: await getTransaction(db, space.primaryCurrency, id) },
      { status: 201 },
    );
  },
);
