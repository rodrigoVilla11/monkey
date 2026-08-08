"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, ImagePlus, Loader2, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ApiError, api } from "@/lib/api-client";
import { spaceScopeKey } from "@/lib/query-keys";
import type { AttachmentDTO } from "@/shared/contracts/attachments";
import {
  MAX_ATTACHMENTS_PER_TRANSACTION,
  MAX_ATTACHMENT_BYTES,
} from "@/shared/contracts/attachments";
import { formatBytes } from "@/shared/file-type";

/**
 * Adjuntos de un movimiento: el recibo, la factura.
 *
 * ── Por qué las imágenes se piden con `fetch` y no con `<img src>` ──────────
 *
 * Porque la descarga exige sesión. En la web la cookie httpOnly viaja sola y un
 * `src` directo funcionaría, pero el mismo componente tiene que servir para un
 * cliente que autentica con `Authorization: Bearer` — y una etiqueta `img` no
 * sabe mandar cabeceras. Se descarga con `fetch` y se muestra desde un blob.
 *
 * El coste es que hay que liberar los blobs; se hace al desmontar.
 */
export function AttachmentsPanel({
  spaceId,
  transactionId,
  locale,
  canEdit,
}: {
  spaceId: string;
  transactionId: string;
  locale: string;
  canEdit: boolean;
}) {
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);

  const attachments = useQuery({
    queryKey: [...spaceScopeKey(spaceId), "attachments", transactionId],
    queryFn: () =>
      api.get<{ attachments: AttachmentDTO[] }>(
        `/spaces/${spaceId}/transactions/${transactionId}/attachments`,
      ),
    select: (data) => data.attachments,
    enabled: spaceId !== "" && transactionId !== "",
  });

  const invalidate = (): void => {
    void queryClient.invalidateQueries({
      queryKey: [...spaceScopeKey(spaceId), "attachments", transactionId],
    });
  };

  const upload = useMutation({
    mutationFn: async (file: File) => {
      /**
       * Va por `fetch` a mano y no por el cliente tipado: es multipart, no
       * JSON. NO se pone `Content-Type` a propósito — el navegador tiene que
       * generarlo con el boundary.
       */
      const form = new FormData();
      form.append("file", file);

      const response = await fetch(
        `/api/v1/spaces/${spaceId}/transactions/${transactionId}/attachments`,
        { method: "POST", body: form, credentials: "include" },
      );

      if (!response.ok) {
        const body: unknown = await response.json().catch(() => null);
        const message =
          typeof body === "object" &&
          body !== null &&
          "error" in body &&
          typeof (body as { error: { message?: unknown } }).error.message ===
            "string"
            ? (body as { error: { message: string } }).error.message
            : "No se pudo subir";
        throw new Error(message);
      }
    },
    onSuccess: () => {
      toast.success("Adjunto subido");
      invalidate();
    },
    onError: (error: unknown) => {
      toast.error(
        error instanceof ApiError || error instanceof Error
          ? error.message
          : "No se pudo subir",
      );
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) =>
      api.delete(`/spaces/${spaceId}/attachments/${id}`),
    onSuccess: () => {
      toast.success("Adjunto eliminado");
      invalidate();
    },
  });

  const items = attachments.data ?? [];
  const full = items.length >= MAX_ATTACHMENTS_PER_TRANSACTION;

  const onFile = (file: File | undefined): void => {
    if (file === undefined) return;

    // Se comprueba acá también para no subir 40 MB y que el servidor los
    // rechace: el aviso llega antes y no se gasta la conexión de nadie.
    if (file.size > MAX_ATTACHMENT_BYTES) {
      toast.error(
        `El archivo pesa más de ${String(MAX_ATTACHMENT_BYTES / 1024 / 1024)} MB`,
      );
      return;
    }

    upload.mutate(file);
    if (fileInput.current !== null) fileInput.current.value = "";
  };

  return (
    <section className="space-y-2">
      <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        Adjuntos
      </h3>

      {items.length > 0 && (
        <ul className="space-y-2">
          {items.map((attachment) => (
            <li key={attachment.id} className="flex items-center gap-3">
              <AttachmentThumb attachment={attachment} />

              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">{attachment.originalName}</p>
                <p className="text-xs text-muted-foreground">
                  {formatBytes(attachment.sizeBytes, locale)} ·{" "}
                  {attachment.uploadedBy.name}
                </p>
              </div>

              {canEdit && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="min-h-touch min-w-touch shrink-0 text-muted-foreground"
                  aria-label={`Eliminar ${attachment.originalName}`}
                  onClick={() => {
                    remove.mutate(attachment.id);
                  }}
                >
                  <Trash2 className="size-4" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {canEdit && (
        <>
          <input
            ref={fileInput}
            type="file"
            // `capture` no se pone: forzaría la cámara y a veces el recibo ya
            // está en el carrete.
            accept="image/jpeg,image/png,image/webp,image/heic,application/pdf"
            className="sr-only"
            onChange={(e) => {
              onFile(e.target.files?.[0]);
            }}
          />

          <Button
            variant="outline"
            className="min-h-touch w-full"
            disabled={upload.isPending || full}
            onClick={() => {
              fileInput.current?.click();
            }}
          >
            {upload.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <>
                <ImagePlus className="size-4" />
                {full ? "Máximo alcanzado" : "Adjuntar recibo"}
              </>
            )}
          </Button>
        </>
      )}

      {items.length === 0 && !canEdit && (
        <p className="text-xs text-muted-foreground">Sin adjuntos</p>
      )}
    </section>
  );
}

/**
 * Miniatura de un adjunto.
 *
 * Las imágenes se descargan con `fetch` y se muestran desde un blob, por lo
 * explicado arriba. Los PDF muestran un icono: renderizar la primera página
 * exigiría traer un visor entero al bundle para una miniatura de 48 píxeles.
 */
function AttachmentThumb({ attachment }: { attachment: AttachmentDTO }) {
  const [url, setUrl] = useState<string | null>(null);

  const image = useQuery({
    queryKey: ["attachment-blob", attachment.id],
    queryFn: async () => {
      const response = await fetch(attachment.downloadPath, {
        credentials: "include",
      });
      if (!response.ok) throw new Error("no se pudo cargar");

      const objectUrl = URL.createObjectURL(await response.blob());
      setUrl(objectUrl);
      return objectUrl;
    },
    enabled: attachment.isImage,
    // El adjunto no cambia nunca: se borra y se sube otro.
    staleTime: Infinity,
    gcTime: Infinity,
  });

  if (!attachment.isImage) {
    return (
      <a
        href={attachment.downloadPath}
        target="_blank"
        rel="noreferrer"
        className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-secondary"
        aria-label={`Abrir ${attachment.originalName}`}
      >
        <FileText className="size-5 text-muted-foreground" />
      </a>
    );
  }

  if (image.isPending || url === null) {
    return (
      <div className="size-12 shrink-0 animate-pulse rounded-lg bg-secondary" />
    );
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="size-12 shrink-0 overflow-hidden rounded-lg"
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- es un blob local,
          no una URL que next/image pueda optimizar. */}
      <img
        src={url}
        alt={attachment.originalName}
        className="size-full object-cover"
      />
    </a>
  );
}
