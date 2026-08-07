import { z } from "zod";

import { route } from "@/server/api/handler";
import { json } from "@/server/api/responses";
import { systemClient } from "@/server/db/system";
import { addPayment, getDebt } from "@/server/services/debts";
import {
  createDebtPaymentRequestSchema,
  type CreateDebtPaymentRequest,
} from "@/shared/contracts/debts";

export const runtime = "nodejs";

const paramsSchema = z.object({
  spaceId: z.string().min(1),
  debtId: z.string().min(1),
});
type Params = z.infer<typeof paramsSchema>;

/**
 * POST — registra un pago. MEMBER o superior.
 *
 * No crea ningún movimiento: o se vincula uno que ya existe o es puro registro.
 * Si creara uno, cargar el pago desde acá y desde la pantalla de movimientos
 * duplicaría el gasto.
 *
 * Devuelve la deuda entera y no solo el pago: quien acaba de pagar quiere ver
 * cuánto le queda, no el recibo.
 */
export const POST = route<CreateDebtPaymentRequest, Params>(
  {
    body: createDebtPaymentRequestSchema,
    params: paramsSchema,
    space: { minRole: "MEMBER" },
  },
  async ({ body, params, access, db, logger }) => {
    const space = await systemClient().space.findUniqueOrThrow({
      where: { id: access.spaceId },
      select: { primaryCurrency: true, timezone: true },
    });

    const id = await systemClient().$transaction(async (tx) =>
      addPayment(
        db,
        tx,
        { spaceId: access.spaceId, primaryCurrency: space.primaryCurrency },
        params.debtId,
        space.timezone,
        body,
      ),
    );

    logger.info(
      {
        debtId: params.debtId,
        paymentId: id,
        linked: body.transactionId !== undefined,
      },
      "pago de deuda registrado",
    );

    return json(
      { debt: await getDebt(db, space.timezone, params.debtId) },
      { status: 201 },
    );
  },
);
