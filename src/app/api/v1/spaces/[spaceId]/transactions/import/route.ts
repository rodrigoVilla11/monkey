import { z } from "zod";

import { route } from "@/server/api/handler";
import { json } from "@/server/api/responses";
import { systemClient } from "@/server/db/system";
import { importTransactions } from "@/server/services/import-export/import";
import {
  importRequestSchema,
  type ImportRequest,
} from "@/shared/contracts/import-export";

export const runtime = "nodejs";

const paramsSchema = z.object({ spaceId: z.string().min(1) });
type Params = z.infer<typeof paramsSchema>;

/**
 * POST — importa movimientos desde un CSV. MEMBER o superior.
 *
 * Con `dryRun: true` no escribe nada y devuelve exactamente el mismo informe:
 * la previsualización recorre TODO el camino —parseo, validación, duplicados,
 * resolución de categorías— y solo se salta la escritura. Es lo que garantiza
 * que no pueda mentir sobre lo que va a pasar.
 *
 * Todo va en UNA transacción de base. Media importación es peor que ninguna:
 * dejaría al usuario sin saber cuánto entró y con un archivo que ya no puede
 * reimportar sin duplicar.
 */
export const POST = route<ImportRequest, Params>(
  {
    body: importRequestSchema,
    params: paramsSchema,
    space: { minRole: "MEMBER" },
    // Parsear miles de filas no es gratis y no hay motivo para hacerlo en
    // ráfaga.
    rateLimit: { limit: 10, windowSeconds: 60 },
  },
  async ({ body, access, session, db, logger }) => {
    const space = await systemClient().space.findUniqueOrThrow({
      where: { id: access.spaceId },
      select: { primaryCurrency: true, timezone: true },
    });

    const report = await systemClient().$transaction(async (tx) =>
      importTransactions(
        db,
        tx,
        {
          spaceId: access.spaceId,
          primaryCurrency: space.primaryCurrency,
          timezone: space.timezone,
        },
        { userId: access.userId, name: session.name },
        body,
      ),
    );

    // Sin importes: en el log no van datos financieros.
    logger.info(
      {
        dryRun: report.dryRun,
        totalRows: report.totalRows,
        created: report.created,
        skipped: report.skipped,
        failed: report.failed,
      },
      body.dryRun ? "previsualización de importación" : "importación aplicada",
    );

    return json({ report });
  },
);
