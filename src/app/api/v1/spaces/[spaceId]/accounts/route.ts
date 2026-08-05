import { z } from "zod";

import { route } from "@/server/api/handler";
import { json } from "@/server/api/responses";
import { systemClient } from "@/server/db/system";
import { createAccount, listAccounts } from "@/server/services/accounts";
import {
  createAccountRequestSchema,
  type CreateAccountRequest,
} from "@/shared/contracts/accounts";

export const runtime = "nodejs";

const paramsSchema = z.object({
  spaceId: z.string().min(1),
  includeArchived: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
});
type Params = z.infer<typeof paramsSchema>;

/** GET — cuentas con su saldo calculado. Cualquier miembro. */
export const GET = route<undefined, Params>(
  { params: paramsSchema, space: { minRole: "VIEWER" } },
  async ({ params, db }) =>
    json({
      accounts: await listAccounts(db, {
        includeArchived: params.includeArchived,
      }),
    }),
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
