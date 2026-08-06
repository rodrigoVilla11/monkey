import { z } from "zod";

import { route } from "@/server/api/handler";
import { json } from "@/server/api/responses";
import { systemClient } from "@/server/db/system";
import { defaultRange, memberReport } from "@/server/services/reports";
import { categoryReportQuerySchema } from "@/shared/contracts/reports-v2";

export const runtime = "nodejs";

const paramsSchema = z
  .object({ spaceId: z.string().min(1) })
  .and(categoryReportQuerySchema);
type Params = z.infer<typeof paramsSchema>;

/**
 * GET /api/v1/spaces/:spaceId/reports/members?from=&to=&kind=EXPENSE
 *
 * Quién cargó cuánto. Solo tiene sentido en Spaces compartidos; en uno
 * personal sería una sola barra al 100%. Se devuelve igual y la UI decide si
 * lo muestra, para no meter una regla de presentación en la API.
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
      await memberReport(
        db,
        { spaceId: access.spaceId, primaryCurrency: space.primaryCurrency },
        params.from ?? fallback.from,
        params.to ?? fallback.to,
        params.kind,
      ),
    );
  },
);
