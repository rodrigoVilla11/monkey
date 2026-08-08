import { z } from "zod";

import { route } from "@/server/api/handler";
import { json } from "@/server/api/responses";
import { systemClient } from "@/server/db/system";
import { createAccount, listAccounts } from "@/server/services/accounts";
import {
  createAccountRequestSchema,
  type CreateAccountRequest,
} from "@/shared/contracts/accounts";
import { todayIn } from "@/shared/dates";

export const runtime = "nodejs";

const paramsSchema = z.object({
  spaceId: z.string().min(1),
  includeArchived: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
});
type Params = z.infer<typeof paramsSchema>;

/**
 * GET — cuentas con su saldo calculado. Cualquier miembro.
 *
 * Las que están en otra moneda traen además el saldo convertido a la primaria
 * del Space, al tipo de HOY. Convertir al tipo de hoy es correcto acá y no lo
 * sería en un reporte: un saldo es una posición actual, mientras que el gasto
 * de enero es un hecho pasado que quedó congelado a su cotización.
 */
export const GET = route<undefined, Params>(
  { params: paramsSchema, space: { minRole: "VIEWER" } },
  async ({ params, access, db }) => {
    const space = await systemClient().space.findUniqueOrThrow({
      where: { id: access.spaceId },
      select: { primaryCurrency: true, timezone: true },
    });

    return json({
      accounts: await listAccounts(db, {
        includeArchived: params.includeArchived,
        primaryCurrency: space.primaryCurrency,
        today: todayIn(space.timezone),
      }),
    });
  },
);

/** POST — MEMBER o superior. Un VIEWER no carga nada. */
export const POST = route<CreateAccountRequest, Params>(
  {
    body: createAccountRequestSchema,
    params: paramsSchema,
    space: { minRole: "MEMBER" },
  },
  async ({ body, access, db }) => {
    // La moneda por defecto es la primaria del Space, pero una cuenta puede
    // tener la suya: una caja de ahorro en dólares dentro de un Space en euros.
    const space = await systemClient().space.findUniqueOrThrow({
      where: { id: access.spaceId },
      select: { primaryCurrency: true },
    });

    const account = await createAccount(
      db,
      access.spaceId,
      body,
      space.primaryCurrency,
    );

    return json({ account }, { status: 201 });
  },
);
