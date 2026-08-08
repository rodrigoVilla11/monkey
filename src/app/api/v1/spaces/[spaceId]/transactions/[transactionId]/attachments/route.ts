import { z } from "zod";

import { route } from "@/server/api/handler";
import { errors } from "@/server/api/errors";
import { json } from "@/server/api/responses";
import { systemClient } from "@/server/db/system";
import {
  listAttachments,
  uploadAttachment,
} from "@/server/services/attachments";
import { MAX_ATTACHMENT_BYTES } from "@/shared/contracts/attachments";

export const runtime = "nodejs";

const paramsSchema = z.object({
  spaceId: z.string().min(1),
  transactionId: z.string().min(1),
});
type Params = z.infer<typeof paramsSchema>;

export const GET = route<undefined, Params>(
  { params: paramsSchema, space: { minRole: "VIEWER" } },
  async ({ params, access, db }) =>
    json({
      attachments: await listAttachments(
        db,
        access.spaceId,
        params.transactionId,
      ),
    }),
);

/**
 * POST — sube un adjunto. MEMBER o superior.
 *
 * Va por `multipart/form-data` y no por JSON: mandar un archivo en base64 lo
 * infla un 33 % sin ganar nada. Por eso el handler no declara `body` y lee el
 * formulario a mano — el wrapper solo parsea JSON.
 *
 * El tipo del archivo se decide leyendo sus bytes, nunca el `Content-Type` que
 * viene en el formulario: lo pone el cliente.
 */
export const POST = route<undefined, Params>(
  {
    params: paramsSchema,
    space: { minRole: "MEMBER" },
    // Subir archivos es caro y no hay motivo para hacerlo en ráfaga.
    rateLimit: { limit: 30, windowSeconds: 60 },
  },
  async ({ request, params, access, db, logger }) => {
    const form = await readForm(request);
    const file = form.get("file");

    if (!(file instanceof File)) {
      throw errors.validation({ file: "Falta el archivo" });
    }

    /**
     * Se comprueba el tamaño ANTES de leer el archivo a memoria. Leerlo
     * primero y validar después dejaría que cualquiera reserve 500 MB en el
     * servidor con una petición.
     */
    if (file.size > MAX_ATTACHMENT_BYTES) {
      throw errors.conflict(
        "UNPROCESSABLE",
        `El archivo pesa más de ${String(MAX_ATTACHMENT_BYTES / 1024 / 1024)} MB`,
      );
    }

    const bytes = new Uint8Array(await file.arrayBuffer());

    const attachment = await systemClient().$transaction(async (tx) =>
      uploadAttachment(
        db,
        tx,
        access.spaceId,
        { userId: access.userId },
        {
          transactionId: params.transactionId,
          filename: file.name,
          bytes,
        },
      ),
    );

    // Sin el nombre del archivo: puede contener datos personales.
    logger.info(
      {
        attachmentId: attachment.id,
        mimeType: attachment.mimeType,
        sizeBytes: attachment.sizeBytes,
      },
      "adjunto subido",
    );

    return json({ attachment }, { status: 201 });
  },
);

const readForm = async (request: Request): Promise<FormData> => {
  try {
    return await request.formData();
  } catch {
    throw errors.validation({
      body: "Se esperaba multipart/form-data con un campo `file`",
    });
  }
};
