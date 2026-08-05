import { z } from "zod";

import { route } from "@/server/api/handler";
import { json } from "@/server/api/responses";
import { previewInvitation } from "@/server/services/spaces/invitations";

export const runtime = "nodejs";

const paramsSchema = z.object({ token: z.string().min(1) });
type Params = z.infer<typeof paramsSchema>;

/**
 * GET /api/v1/invitations/:token
 *
 * Vista previa SIN sesión: el enlace llega por mail y la persona puede no
 * tener cuenta todavía. La pantalla necesita poder decir "te invitaron a X
 * como Y" antes de mandar a registrarse.
 *
 * Devuelve lo mínimo — nombre del Space, rol y quién invita. Nada de miembros,
 * cuentas ni saldos: quien tiene el enlace todavía no es miembro de nada.
 */
export const GET = route<undefined, Params>(
  { params: paramsSchema },
  async ({ params }) =>
    json({ invitation: await previewInvitation(params.token) }),
);
