import { z } from "zod";

import { route } from "@/server/api/handler";
import { attachment } from "@/server/api/responses";
import { systemClient } from "@/server/db/system";
import { exportTransactions } from "@/server/services/import-export/export";
import { exportQuerySchema } from "@/shared/contracts/import-export";

export const runtime = "nodejs";

const paramsSchema = z
  .object({ spaceId: z.string().min(1) })
  .and(exportQuerySchema);
type Params = z.infer<typeof paramsSchema>;

/**
 * GET — descarga los movimientos como CSV. VIEWER alcanza.
 *
 * Responde `text/csv` con `Content-Disposition: attachment`, no JSON: el
 * navegador tiene que ofrecer guardar el archivo sin que el cliente arme nada.
 *
 * El separador sale del locale de quien pide. Donde la coma es el separador
 * decimal —España, Argentina— Excel espera `;`, y con `,` abre el archivo
 * entero en una sola columna.
 */
export const GET = route<undefined, Params>(
  { params: paramsSchema, space: { minRole: "VIEWER" } },
  async ({ params, access, session, db, logger }) => {
    const space = await systemClient().space.findUniqueOrThrow({
      where: { id: access.spaceId },
      select: { name: true },
    });

    const result = await exportTransactions(db, {
      locale: session.locale,
      spaceName: space.name,
      query: params,
    });

    logger.info({ rows: result.rowCount }, "exportación de movimientos");

    return attachment(result.csv, {
      filename: result.filename,
      contentType: "text/csv; charset=utf-8",
    });
  },
);
