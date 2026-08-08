import { z } from "zod";

import { route } from "@/server/api/handler";
import { json } from "@/server/api/responses";
import { systemClient } from "@/server/db/system";
import { createSettlement, splitSummary } from "@/server/services/splits";
import {
  createSettlementRequestSchema,
  type CreateSettlementRequest,
} from "@/shared/contracts/splits";

export const runtime = "nodejs";

const paramsSchema = z.object({ spaceId: z.string().min(1) });
type Params = z.infer<typeof paramsSchema>;

const spaceContext = async (spaceId: string) => {
  const space = await systemClient().space.findUniqueOrThrow({
    where: { id: spaceId },
    select: { primaryCurrency: true, timezone: true },
  });
  return { spaceId, ...space };
};

/**
 * GET — quién le debe a quién, con los pagos que lo dejarían en cero.
 *
 * Devuelve el resumen entero y no solo los saldados: quien abre esta pantalla
 * viene a ver el número, no el historial.
 */
export const GET = route<undefined, Params>(
  { params: paramsSchema, space: { minRole: "VIEWER" } },
  async ({ access, db }) =>
    json({
      summary: await splitSummary(db, await spaceContext(access.spaceId)),
    }),
);

/**
 * POST — registra que alguien le pagó a alguien. MEMBER o superior.
 *
 * **No genera un movimiento.** Saldar no mueve el patrimonio del Space, solo
 * reequilibra quién puso qué dentro de él. Si generara uno, el mes en que se
 * saldan las cuentas parecería el mes de un gasto enorme.
 */
export const POST = route<CreateSettlementRequest, Params>(
  {
    body: createSettlementRequestSchema,
    params: paramsSchema,
    space: { minRole: "MEMBER" },
  },
  async ({ body, access, db, logger }) => {
    const space = await spaceContext(access.spaceId);

    const id = await systemClient().$transaction(async (tx) =>
      createSettlement(db, tx, space, { userId: access.userId }, body),
    );

    logger.info({ settlementId: id }, "saldado registrado");

    return json({ summary: await splitSummary(db, space) }, { status: 201 });
  },
);
