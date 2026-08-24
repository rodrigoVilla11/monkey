import { z } from "zod";

import { errors } from "@/server/api/errors";
import { route } from "@/server/api/handler";
import { json } from "@/server/api/responses";
import { materializeDueRules } from "@/server/services/recurring/materialize";
import { todayIn } from "@/shared/dates";

export const runtime = "nodejs";

const paramsSchema = z.object({
  spaceId: z.string().min(1),
  ruleId: z.string().min(1),
});
type Params = z.infer<typeof paramsSchema>;

/**
 * POST — MEMBER o superior. Acepta YA las ocurrencias vencidas de la regla.
 *
 * Es el botón "Aceptar" de Programados: en vez de esperar al cron o al barrido
 * del inicio, quien está mirando la regla el día que vence la materializa ahí
 * mismo. Las ocurrencias nacen CLEARED aunque la regla no tenga `autoPost` —
 * aceptar ES confirmar; hacerlas nacer pendientes obligaría a confirmar lo
 * mismo dos veces.
 *
 * Idempotente contra el cron y el barrido del inicio: el unique parcial
 * (spaceId, recurringRuleId, date) descarta duplicados. Si no hay nada
 * vencido, responde `created: 0` y no pasa nada.
 */
export const POST = route<undefined, Params>(
  { params: paramsSchema, space: { minRole: "MEMBER" } },
  async ({ params, access, session, db, logger }) => {
    // 404 antes de barrer: el cliente scopeado garantiza que una regla de otro
    // Space no aparezca, y "no encontrada" es la respuesta correcta para eso.
    const rule = await db.recurringRule.findFirst({
      where: { id: params.ruleId },
      select: { id: true },
    });
    if (rule === null) throw errors.notFound("No se encontró la regla");

    const report = await materializeDueRules({
      spaceId: access.spaceId,
      ruleId: params.ruleId,
      until: todayIn(session.timezone),
      post: true,
      logger,
    });

    return json({
      created: report.transactionsCreated,
      truncated: report.rulesTruncated > 0,
    });
  },
);
