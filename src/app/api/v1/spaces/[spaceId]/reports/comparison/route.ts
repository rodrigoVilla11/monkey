import { z } from "zod";

import { route } from "@/server/api/handler";
import { json } from "@/server/api/responses";
import { systemClient } from "@/server/db/system";
import { comparisonReport } from "@/server/services/reports";
import { comparisonQuerySchema } from "@/shared/contracts/reports-v2";
import { monthRange, todayIn } from "@/shared/dates";
import { rangeFromQuery } from "@/shared/periods";

export const runtime = "nodejs";

const paramsSchema = z
  .object({ spaceId: z.string().min(1) })
  .and(comparisonQuerySchema);
type Params = z.infer<typeof paramsSchema>;

/**
 * GET /api/v1/spaces/:spaceId/reports/comparison?from=&to=&kind=&against=
 * GET /api/v1/spaces/:spaceId/reports/comparison?month=&kind=EXPENSE
 *
 * Un período contra el inmediatamente anterior del mismo largo —o contra el
 * mismo período del año pasado, con `against=year`—, categoría por categoría,
 * ordenado por cuánto cambió cada una. Incluye las que tenían movimientos
 * antes y ahora no: "dejaste de gastar en esto" es información, no ausencia
 * de ella.
 */
export const GET = route<undefined, Params>(
  { params: paramsSchema, space: { minRole: "VIEWER" } },
  async ({ params, access, session }) => {
    const space = await systemClient().space.findUniqueOrThrow({
      where: { id: access.spaceId },
      select: { primaryCurrency: true },
    });

    const current = rangeFromQuery(params, () =>
      monthRange(params.month ?? todayIn(session.timezone)),
    );

    return json(
      await comparisonReport(
        { spaceId: access.spaceId, primaryCurrency: space.primaryCurrency },
        current,
        params.kind,
        params.against,
      ),
    );
  },
);
