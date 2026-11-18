import { z } from "zod";

import { route } from "@/server/api/handler";
import { json } from "@/server/api/responses";
import { resolveAcceptAccount } from "@/server/services/recurring";
import { materializeDueRules } from "@/server/services/recurring/materialize";
import {
  acceptRecurringRuleRequestSchema,
  type AcceptRecurringRuleRequest,
} from "@/shared/contracts/recurring";
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
 * Si la regla no tiene cuenta, este es el momento de elegirla: `accountId` en
 * el body, del Space y en la moneda del programado. Con cuenta en la regla, el
 * body se ignora.
 *
 * Idempotente contra el cron y el barrido del inicio: el unique parcial
 * (spaceId, recurringRuleId, date) descarta duplicados. Si no hay nada
 * vencido, responde `created: 0` y no pasa nada.
 */
export const POST = route<AcceptRecurringRuleRequest, Params>(
  {
    body: acceptRecurringRuleRequestSchema,
    params: paramsSchema,
    space: { minRole: "MEMBER" },
  },
  async ({ body, params, access, session, db, logger }) => {
    // 404 antes de barrer: el cliente scopeado garantiza que una regla de otro
    // Space no aparezca, y "no encontrada" es la respuesta correcta para eso.
    const { accountId } = await resolveAcceptAccount(
      db,
      params.ruleId,
      body.accountId,
    );

    const report = await materializeDueRules({
      spaceId: access.spaceId,
      ruleId: params.ruleId,
      until: todayIn(session.timezone),
      post: true,
      accountId,
      logger,
    });

    return json({
      created: report.transactionsCreated,
      truncated: report.rulesTruncated > 0,
    });
  },
);
