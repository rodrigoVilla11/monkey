import { z } from "zod";

import { route } from "@/server/api/handler";
import { json } from "@/server/api/responses";
import { systemClient } from "@/server/db/system";
import { categoryReport, defaultRange } from "@/server/services/reports";
import { categoryReportQuerySchema } from "@/shared/contracts/reports-v2";

export const runtime = "nodejs";

const paramsSchema = z
  .object({ spaceId: z.string().min(1) })
  .and(categoryReportQuerySchema);
type Params = z.infer<typeof paramsSchema>;

/**
 * GET /api/v1/spaces/:spaceId/reports/categories?from=&to=&kind=EXPENSE
 *
 * Desglose por categoría con las subcategorías anidadas bajo su padre. Si no
 * se pasa rango, el mes en curso en la timezone de quien pregunta.
 */
export const GET = route<undefined, Params>(
  { params: paramsSchema, space: { minRole: "VIEWER" } },
  async ({ params, access, session, db }) => {
    const space = await systemClient().space.findUniqueOrThrow({
      where: { id: access.spaceId },
      select: { primaryCurrency: true },
    });

    const fallback = defaultRange(session.timezone);

    return json(
      await categoryReport(
        db,
        { spaceId: access.spaceId, primaryCurrency: space.primaryCurrency },
        params.from ?? fallback.from,
        params.to ?? fallback.to,
        params.kind,
      ),
    );
  },
);
