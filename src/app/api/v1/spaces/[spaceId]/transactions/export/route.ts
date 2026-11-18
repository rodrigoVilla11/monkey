import { z } from "zod";

import { route } from "@/server/api/handler";
import { attachment } from "@/server/api/responses";
import { systemClient } from "@/server/db/system";
import { exportTransactions } from "@/server/services/import-export/export";
import { exportWorkbook } from "@/server/services/import-export/xlsx";
import { exportQuerySchema } from "@/shared/contracts/import-export";

export const runtime = "nodejs";

const paramsSchema = z
  .object({ spaceId: z.string().min(1) })
  .and(exportQuerySchema);
type Params = z.infer<typeof paramsSchema>;

const XLSX_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/**
 * GET — descarga los movimientos. VIEWER alcanza.
 *
 * `format=csv` (por defecto) devuelve `text/csv`: una tabla plana que se puede
 * volver a importar. `format=xlsx` devuelve un libro de Excel con los
 * movimientos y hojas de resumen por período, categoría y miembro: es para
 * mirar y repartir, no para reimportar.
 *
 * Las dos responden con `Content-Disposition: attachment`, no JSON: el
 * navegador tiene que ofrecer guardar el archivo sin que el cliente arme nada.
 *
 * El separador del CSV sale del locale de quien pide. Donde la coma es el
 * separador decimal —España, Argentina— Excel espera `;`, y con `,` abre el
 * archivo entero en una sola columna.
 */
export const GET = route<undefined, Params>(
  { params: paramsSchema, space: { minRole: "VIEWER" } },
  async ({ params, access, session, db, logger }) => {
    const space = await systemClient().space.findUniqueOrThrow({
      where: { id: access.spaceId },
      select: { name: true, primaryCurrency: true },
    });

    if (params.format === "xlsx") {
      const result = await exportWorkbook(db, {
        space: {
          spaceId: access.spaceId,
          name: space.name,
          primaryCurrency: space.primaryCurrency,
        },
        locale: session.locale,
        timezone: session.timezone,
        weekStartsOn: session.weekStartsOn,
        query: params,
      });

      logger.info({ rows: result.rowCount }, "exportación a Excel");

      return attachment(result.buffer, {
        filename: result.filename,
        contentType: XLSX_TYPE,
      });
    }

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
