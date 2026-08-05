import { z } from "zod";

import { route } from "@/server/api/handler";
import { json } from "@/server/api/responses";
import { setArchived } from "@/server/services/accounts";

export const runtime = "nodejs";

const paramsSchema = z.object({
  spaceId: z.string().min(1),
  accountId: z.string().min(1),
});
type Params = z.infer<typeof paramsSchema>;

const bodySchema = z.object({ archived: z.boolean() });
type Body = z.infer<typeof bodySchema>;

/**
 * POST /api/v1/spaces/:spaceId/accounts/:accountId/archive
 *
 * Archivar es la alternativa no destructiva a borrar: la cuenta desaparece de
 * las listas y no admite movimientos nuevos, pero su historial sigue contando
 * en los reportes. Es lo que se recomienda cuando una cuenta tiene
 * movimientos.
 */
export const POST = route<Body, Params>(
  { body: bodySchema, params: paramsSchema, space: { minRole: "MEMBER" } },
  async ({ body, params, db }) =>
    json({ account: await setArchived(db, params.accountId, body.archived) }),
);
