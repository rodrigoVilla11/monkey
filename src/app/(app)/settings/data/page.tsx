"use client";

import { useMutation } from "@tanstack/react-query";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Download, FileUp, Loader2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ApiError, api } from "@/lib/api-client";
import { useAccounts } from "@/lib/hooks/use-domain";
import { useActiveSpace } from "@/lib/hooks/use-session";
import { spaceScopeKey } from "@/lib/query-keys";
import { cn } from "@/lib/utils";
import type { ImportReport, RowStatus } from "@/shared/contracts/import-export";
import { hasAtLeast } from "@/shared/roles";
import { stripBom } from "@/shared/csv";

const STATUS_STYLE: Record<RowStatus, string> = {
  ok: "text-muted-foreground",
  warning: "text-amber-600 dark:text-amber-400",
  duplicate: "text-muted-foreground",
  error: "text-expense",
};

const STATUS_LABEL: Record<RowStatus, string> = {
  ok: "Entra",
  warning: "Aviso",
  duplicate: "Duplicado",
  error: "Error",
};

/**
 * Importar y exportar.
 *
 * El flujo es en dos pasos a propósito: se elige el archivo, se ve QUÉ va a
 * pasar con cada fila, y recién ahí se confirma. La previsualización usa el
 * mismo endpoint con `dryRun`, así que no puede prometer algo distinto de lo
 * que después ocurre.
 */
export default function DataPage() {
  const { space } = useActiveSpace();
  const spaceId = space?.id ?? "";
  const canImport = space !== undefined && hasAtLeast(space.role, "MEMBER");

  return (
    <div className="space-y-4 py-3">
      <h1 className="text-xl font-semibold">Importar y exportar</h1>

      <ExportCard spaceId={spaceId} />
      {canImport && <ImportCard spaceId={spaceId} />}
    </div>
  );
}

function ExportCard({ spaceId }: { spaceId: string }) {
  const [busy, setBusy] = useState(false);

  const download = async (): Promise<void> => {
    setBusy(true);
    try {
      /**
       * Va por `fetch` a mano y no por el cliente tipado porque la respuesta es
       * un archivo, no JSON. Se descarga con un enlace temporal: es la única
       * forma de que el navegador respete el nombre del Content-Disposition.
       */
      const response = await fetch(
        `/api/v1/spaces/${spaceId}/transactions/export`,
        { credentials: "include" },
      );

      if (!response.ok) throw new Error("fallo la descarga");

      const blob = await response.blob();
      const name =
        /filename="([^"]+)"/.exec(
          response.headers.get("content-disposition") ?? "",
        )?.[1] ?? "monkey.csv";

      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = name;
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error("No se pudo exportar");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="gap-3 p-4">
      <div className="flex items-center gap-2">
        <Download className="size-4" />
        <span className="text-sm font-semibold">Exportar movimientos</span>
      </div>
      <p className="text-xs text-muted-foreground">
        Un CSV con todo lo cargado. Se abre en Excel o Google Sheets sin tocar
        nada, y se puede volver a importar sin que se duplique nada.
      </p>
      <Button
        variant="outline"
        className="min-h-touch"
        disabled={busy || spaceId === ""}
        onClick={() => {
          void download();
        }}
      >
        {busy ? <Loader2 className="size-4 animate-spin" /> : "Descargar CSV"}
      </Button>
    </Card>
  );
}

function ImportCard({ spaceId }: { spaceId: string }) {
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);

  const [content, setContent] = useState<string | null>(null);
  const [filename, setFilename] = useState("");
  const [accountId, setAccountId] = useState<string | null>(null);
  const [createCategories, setCreateCategories] = useState(false);
  const [report, setReport] = useState<ImportReport | null>(null);

  const accounts = useAccounts(spaceId);
  const active = accounts.data?.filter((a) => !a.isArchived) ?? [];

  const run = useMutation({
    mutationFn: (dryRun: boolean) =>
      api.post<{ report: ImportReport }>(
        `/spaces/${spaceId}/transactions/import`,
        {
          content,
          dryRun,
          createMissingCategories: createCategories,
          ...(accountId !== null ? { defaultAccountId: accountId } : {}),
        },
      ),
    onError: (error: unknown) => {
      toast.error(
        error instanceof ApiError
          ? error.message
          : "No se pudo leer el archivo",
      );
    },
  });

  const preview = (): void => {
    run.mutate(true, {
      onSuccess: (data) => {
        setReport(data.report);
      },
    });
  };

  const apply = (): void => {
    run.mutate(false, {
      onSuccess: (data) => {
        setReport(data.report);
        toast.success(`${String(data.report.created)} movimientos importados`);
        setContent(null);
        setFilename("");
        if (fileInput.current !== null) fileInput.current.value = "";
        void queryClient.invalidateQueries({
          queryKey: spaceScopeKey(spaceId),
        });
      },
    });
  };

  const onFile = (file: File | undefined): void => {
    if (file === undefined) return;

    setReport(null);
    setFilename(file.name);

    void file.text().then((text) => {
      // El BOM se quita igual en el servidor; hacerlo acá evita que el
      // contador de caracteres del textarea asuste con un carácter invisible.
      setContent(stripBom(text));
    });
  };

  return (
    <Card className="gap-3 p-4">
      <div className="flex items-center gap-2">
        <Upload className="size-4" />
        <span className="text-sm font-semibold">Importar movimientos</span>
      </div>
      <p className="text-xs text-muted-foreground">
        Un CSV del banco o uno exportado desde acá. Primero te mostramos qué va
        a pasar con cada fila; nada se guarda hasta que confirmes.
      </p>

      <input
        ref={fileInput}
        type="file"
        accept=".csv,text/csv"
        className="sr-only"
        onChange={(e) => {
          onFile(e.target.files?.[0]);
        }}
      />

      <Button
        variant="outline"
        className="min-h-touch justify-start"
        onClick={() => {
          fileInput.current?.click();
        }}
      >
        <FileUp className="size-4" />
        {filename === "" ? "Elegir archivo" : filename}
      </Button>

      {content !== null && (
        <>
          <div className="space-y-2">
            <Label>Cuenta para las filas que no la traigan</Label>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {active.map((account) => (
                <button
                  key={account.id}
                  type="button"
                  onClick={() => {
                    setAccountId(accountId === account.id ? null : account.id);
                  }}
                  aria-pressed={accountId === account.id}
                  className={cn(
                    "min-h-touch shrink-0 rounded-xl border px-3 py-2 text-sm",
                    accountId === account.id && "ring-2 ring-primary",
                  )}
                >
                  {account.name}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
            <div className="min-w-0">
              <Label htmlFor="create-categories">Crear categorías nuevas</Label>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Si no, las filas con una categoría desconocida entran igual pero
                sin categoría.
              </p>
            </div>
            <Switch
              id="create-categories"
              checked={createCategories}
              onCheckedChange={setCreateCategories}
            />
          </div>

          <Button
            variant="outline"
            className="min-h-touch"
            disabled={run.isPending}
            onClick={preview}
          >
            {run.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              "Ver qué va a pasar"
            )}
          </Button>
        </>
      )}

      {report !== null && (
        <div className="space-y-3 border-t pt-3">
          <div className="grid grid-cols-3 gap-2 text-center">
            <Summary label="Entran" value={report.created} />
            <Summary label="Se saltean" value={report.skipped} />
            <Summary label="Fallan" value={report.failed} tone="expense" />
          </div>

          {report.newCategories.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Se crearán {report.newCategories.length} categorías:{" "}
              {report.newCategories.join(", ")}
            </p>
          )}

          {report.issues.length > 0 && (
            <div className="space-y-1.5">
              <p className="flex items-center gap-1.5 text-xs font-medium">
                <AlertTriangle className="size-3.5" />
                {report.issues.length} filas con algo que revisar
              </p>
              {/* Con scroll: un archivo del banco puede traer decenas. */}
              <ul className="max-h-64 space-y-1 overflow-y-auto text-xs">
                {report.issues.map((issue) => (
                  <li key={issue.line} className="flex gap-2">
                    <span className="w-10 shrink-0 text-muted-foreground tabular-nums">
                      L{issue.line}
                    </span>
                    <span
                      className={cn(
                        "w-20 shrink-0",
                        STATUS_STYLE[issue.status],
                      )}
                    >
                      {STATUS_LABEL[issue.status]}
                    </span>
                    <span className="min-w-0 flex-1 text-muted-foreground">
                      {issue.message}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {report.dryRun && report.created > 0 && (
            <Button
              className="min-h-touch w-full"
              disabled={run.isPending}
              onClick={apply}
            >
              {run.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                `Importar ${String(report.created)} movimientos`
              )}
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}

function Summary({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "expense";
}) {
  return (
    <div className="rounded-lg bg-secondary p-2">
      <p
        className={cn(
          "text-lg font-semibold tabular-nums",
          tone === "expense" && value > 0 && "text-expense",
        )}
      >
        {value}
      </p>
      <p className="text-[11px] text-muted-foreground">{label}</p>
    </div>
  );
}
