import { NextResponse } from "next/server";
import { z } from "zod";

import { route } from "@/server/api/handler";
import { noContent } from "@/server/api/responses";
import { systemClient } from "@/server/db/system";
import {
  deleteAttachment,
  readAttachment,
} from "@/server/services/attachments";

export const runtime = "nodejs";

const paramsSchema = z.object({
  spaceId: z.string().min(1),
  attachmentId: z.string().min(1),
});
type Params = z.infer<typeof paramsSchema>;

/**
 * GET — devuelve el archivo. VIEWER alcanza.
 *
 * Es el endpoint que reemplaza a una URL firmada, y la diferencia importa: acá
 * la membresía se comprueba en CADA petición. Una URL firmada minteada cuando
 * eras miembro seguiría funcionando después de que te expulsaran, quedaría en
 * el historial del navegador y viajaría en el `Referer` de cualquier página que
 * la enlazara.
 *
 * ── Las cabeceras no son decorativas ────────────────────────────────────────
 *
 * · `Content-Disposition: inline` para poder mostrar el recibo dentro de la
 *   app, con el nombre saneado para que no se pueda inyectar una cabecera.
 * · `X-Content-Type-Options: nosniff` para que el navegador no reinterprete el
 *   tipo. Sin esto, un archivo que pasó como imagen pero contiene HTML podría
 *   ejecutarse en el origen de la app.
 * · `Content-Security-Policy: sandbox` como segunda barrera para el PDF, que sí
 *   puede traer JavaScript.
 * · `private` en el caché: es un documento de una persona, no puede quedar en
 *   un proxy compartido. `immutable` porque un adjunto nunca cambia — se borra
 *   y se sube otro.
 */
export const GET = route<undefined, Params>(
  { params: paramsSchema, space: { minRole: "VIEWER" } },
  async ({ params, db }) => {
    const file = await readAttachment(db, params.attachmentId);
    const safeName = file.filename.replace(/["\r\n\\]/g, "");

    return new NextResponse(new Uint8Array(file.bytes), {
      status: 200,
      headers: {
        "content-type": file.mimeType,
        "content-length": String(file.bytes.byteLength),
        "content-disposition": `inline; filename="${safeName}"`,
        "x-content-type-options": "nosniff",
        "content-security-policy": "sandbox; default-src 'none'",
        "cache-control": "private, max-age=31536000, immutable",
      },
    });
  },
);

/**
 * DELETE — borra el adjunto. MEMBER o superior.
 *
 * La fila queda con borrado lógico —quién lo subió y cuándo es trazabilidad—
 * pero el archivo se borra del disco de verdad: es un documento personal y
 * "borrar" tiene que borrar.
 */
export const DELETE = route<undefined, Params>(
  { params: paramsSchema, space: { minRole: "MEMBER" } },
  async ({ params, db }) => {
    await systemClient().$transaction(async (tx) => {
      await deleteAttachment(db, tx, params.attachmentId);
    });
    return noContent();
  },
);
