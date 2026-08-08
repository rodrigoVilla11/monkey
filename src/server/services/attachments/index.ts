import { errors } from "@/server/api/errors";
import type { ScopedDb } from "@/server/db/scoped";
import type { TransactionClient } from "@/server/services/audit/log";
import { getStorage } from "@/server/storage";
import type { AttachmentDTO } from "@/shared/contracts/attachments";
import {
  MAX_ATTACHMENTS_PER_TRANSACTION,
  MAX_ATTACHMENT_BYTES,
} from "@/shared/contracts/attachments";
import {
  detectMimeType,
  EXTENSION_BY_MIME,
  sanitizeFilename,
  type DetectedMime,
} from "@/shared/file-type";

/**
 * Adjuntos.
 *
 * ── El orden de las operaciones importa ─────────────────────────────────────
 *
 * Se escribe **primero el archivo y después la fila**, y no al revés. Si falla
 * la fila, queda un archivo huérfano en disco: basura que ocupa espacio y que
 * un barrido puede limpiar. Al revés quedaría una fila apuntando a un archivo
 * que no existe, y eso es una pantalla rota cada vez que alguien la abra.
 *
 * Basura recuperable es mejor que una referencia rota.
 *
 * ── El borrado va al revés, y por el mismo motivo ───────────────────────────
 *
 * Primero la fila, después el archivo. Si falla el borrado del archivo queda
 * basura; si fallara al revés, quedaría una fila sin archivo.
 */

const SELECT = {
  id: true,
  transactionId: true,
  originalName: true,
  mimeType: true,
  sizeBytes: true,
  createdAt: true,
  uploadedByUserId: true,
  uploadedBy: { select: { name: true } },
} as const;

interface Row {
  id: string;
  transactionId: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: Date;
  uploadedByUserId: string | null;
  uploadedBy: { name: string } | null;
}

const toDTO = (row: Row, spaceId: string): AttachmentDTO => ({
  id: row.id,
  transactionId: row.transactionId,
  originalName: row.originalName,
  mimeType: row.mimeType as DetectedMime,
  sizeBytes: row.sizeBytes,
  isImage: row.mimeType.startsWith("image/"),
  downloadPath: `/api/v1/spaces/${spaceId}/attachments/${row.id}`,
  uploadedBy: {
    userId: row.uploadedByUserId,
    // Un usuario borrado deja el adjunto: el recibo sigue siendo del Space.
    name: row.uploadedBy?.name ?? "Ex miembro",
  },
  createdAt: row.createdAt.toISOString(),
});

export const listAttachments = async (
  db: ScopedDb,
  spaceId: string,
  transactionId: string,
): Promise<AttachmentDTO[]> => {
  const transaction = await db.transaction.findFirst({
    where: { id: transactionId },
    select: { id: true },
  });
  if (transaction === null)
    throw errors.notFound("No se encontró el movimiento");

  const rows = await db.attachment.findMany({
    where: { transactionId },
    orderBy: { createdAt: "asc" },
    select: SELECT,
  });

  return rows.map((row) => toDTO(row, spaceId));
};

export interface UploadInput {
  readonly transactionId: string;
  readonly filename: string;
  readonly bytes: Uint8Array;
}

export const uploadAttachment = async (
  db: ScopedDb,
  tx: TransactionClient,
  spaceId: string,
  actor: { readonly userId: string },
  input: UploadInput,
): Promise<AttachmentDTO> => {
  if (input.bytes.byteLength === 0) {
    throw errors.conflict("UNPROCESSABLE", "El archivo está vacío");
  }

  if (input.bytes.byteLength > MAX_ATTACHMENT_BYTES) {
    throw errors.conflict(
      "UNPROCESSABLE",
      `El archivo pesa más de ${String(MAX_ATTACHMENT_BYTES / 1024 / 1024)} MB`,
    );
  }

  /**
   * El tipo sale de los bytes, NO del `Content-Type` que mandó el cliente: un
   * ejecutable renombrado a .jpg y anunciado como image/jpeg pasa cualquier
   * validación basada en lo que dice quien sube.
   */
  const mimeType = detectMimeType(input.bytes);
  if (mimeType === null) {
    throw errors.conflict(
      "UNPROCESSABLE",
      "Solo se admiten imágenes (JPEG, PNG, WebP, HEIC) y PDF",
    );
  }

  const transaction = await db.transaction.findFirst({
    where: { id: input.transactionId },
    select: { id: true },
  });
  if (transaction === null)
    throw errors.notFound("No se encontró el movimiento");

  const existing = await db.attachment.count({
    where: { transactionId: input.transactionId },
  });
  if (existing >= MAX_ATTACHMENTS_PER_TRANSACTION) {
    throw errors.conflict(
      "CONFLICT",
      `Un movimiento admite como mucho ${String(MAX_ATTACHMENTS_PER_TRANSACTION)} adjuntos`,
    );
  }

  // Primero el archivo: un huérfano en disco es basura recuperable, una fila
  // sin archivo es una pantalla rota.
  const stored = await getStorage().put({
    spaceId,
    extension: EXTENSION_BY_MIME[mimeType],
    bytes: input.bytes,
  });

  const created = await tx.attachment.create({
    data: {
      spaceId,
      transactionId: input.transactionId,
      storageKey: stored.key,
      mimeType,
      sizeBytes: stored.sizeBytes,
      originalName: sanitizeFilename(input.filename),
      uploadedByUserId: actor.userId,
    },
    select: SELECT,
  });

  return toDTO(created, spaceId);
};

export interface AttachmentContent {
  readonly bytes: Uint8Array;
  readonly mimeType: string;
  readonly filename: string;
}

/**
 * Contenido de un adjunto.
 *
 * La fila se busca por el cliente scopeado: un adjunto de otro Space no
 * aparece y se responde 404 sin confirmar que exista.
 */
export const readAttachment = async (
  db: ScopedDb,
  id: string,
): Promise<AttachmentContent> => {
  const row = await db.attachment.findFirst({
    where: { id },
    select: { storageKey: true, mimeType: true, originalName: true },
  });

  if (row === null) throw errors.notFound("No se encontró el adjunto");

  try {
    return {
      bytes: await getStorage().get(row.storageKey),
      mimeType: row.mimeType,
      filename: row.originalName,
    };
  } catch {
    /**
     * La fila existe pero el archivo no. Pasa si alguien limpió el directorio
     * a mano o si una copia de la base se restauró sin los archivos. Se
     * responde 404 y no 500: el recurso no está, y no es un fallo del servidor.
     */
    throw errors.notFound("El archivo ya no está disponible");
  }
};

export const deleteAttachment = async (
  db: ScopedDb,
  tx: TransactionClient,
  id: string,
): Promise<void> => {
  const row = await db.attachment.findFirst({
    where: { id },
    select: { id: true, storageKey: true },
  });
  if (row === null) throw errors.notFound("No se encontró el adjunto");

  /**
   * Borrado lógico de la fila y borrado REAL del archivo.
   *
   * Es a propósito: el adjunto es un documento personal y "borrar" tiene que
   * borrar de verdad. La fila queda por trazabilidad —quién lo subió y cuándo—
   * pero el contenido se va del disco.
   */
  await tx.attachment.update({
    where: { id },
    data: { deletedAt: new Date() },
  });

  // Después del borrado lógico: si esto falla queda basura, no una referencia
  // a un archivo que todavía se puede leer.
  await getStorage().remove(row.storageKey);
};
