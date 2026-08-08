import type { DetectedMime } from "../file-type";

/**
 * Adjuntos de un movimiento: el recibo, la factura.
 *
 * ── Las dos decisiones ──────────────────────────────────────────────────────
 *
 * **1. Se sirven por un endpoint autenticado, no por URL firmada.** Una URL
 * firmada es un token en la barra de direcciones: queda en el historial, viaja
 * en el `Referer`, sobrevive a una captura compartida y no se puede revocar —
 * sigue funcionando después de expulsar a alguien del Space. Con un endpoint
 * autenticado el permiso se comprueba contra la membresía en CADA petición. Y
 * al vivir bajo `/api/v1/spaces/:id/**`, el adjunto entra en el mismo borrado
 * de caché por Space que el resto de la API.
 *
 * **2. El tipo se valida por los bytes.** El `Content-Type` lo manda el cliente
 * y por lo tanto no vale nada.
 *
 * No hay esquema Zod para la subida: va por `multipart/form-data` y se valida
 * en el handler. Todo lo demás de la API es JSON, pero mandar un archivo en
 * base64 lo infla un 33 % sin ganar nada.
 *
 * Módulo puro: sin Next, sin Prisma, sin React.
 */

/** 10 MB. Una foto de un recibo pesa menos de 5; un PDF escaneado, menos de 10. */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

/** Cuántos adjuntos admite un movimiento. */
export const MAX_ATTACHMENTS_PER_TRANSACTION = 10;

export interface AttachmentDTO {
  readonly id: string;
  readonly transactionId: string;
  readonly originalName: string;
  readonly mimeType: DetectedMime;
  readonly sizeBytes: number;
  readonly isImage: boolean;
  /**
   * Ruta relativa de descarga, para armar el `src` o el enlace. No es una URL
   * firmada: exige sesión y membresía como cualquier otro endpoint.
   */
  readonly downloadPath: string;
  readonly uploadedBy: {
    readonly userId: string | null;
    readonly name: string;
  };
  readonly createdAt: string;
}
