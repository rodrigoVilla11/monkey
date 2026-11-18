"use client";

import { Download, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { api, ApiError, qs } from "@/lib/api-client";
import { saveBlob } from "@/lib/download";
import { cn } from "@/lib/utils";
import type { ExportFormat } from "@/shared/contracts/import-export";
import type { DateRange } from "@/shared/dates";
import { describeRange } from "@/shared/periods";

type Scope = "period" | "all";

/**
 * Exportar desde Reportes.
 *
 * Lo que se descarga es lo que se está mirando —el período elegido— o todo
 * el historial, opcionalmente de una sola cuenta. El Excel trae los
 * movimientos y hojas de resumen (por período, por categoría, por miembro)
 * ya armadas; el CSV es la tabla plana que se puede volver a importar.
 *
 * La descarga va por el cliente de la API y no por un enlace directo: así
 * renueva la sesión si el token venció en vez de guardar un JSON de error.
 */
export function ExportDrawer({
  spaceId,
  range,
  locale,
  accounts,
}: {
  spaceId: string;
  range: DateRange;
  locale: string;
  accounts: readonly { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<Scope>("period");
  const [accountId, setAccountId] = useState<string | null>(null);
  const [format, setFormat] = useState<ExportFormat>("xlsx");
  const [busy, setBusy] = useState(false);

  const download = async (): Promise<void> => {
    setBusy(true);
    try {
      const file = await api.download(
        `/spaces/${spaceId}/transactions/export${qs({
          format,
          from: scope === "period" ? range.start : undefined,
          to: scope === "period" ? range.end : undefined,
          accountId,
        })}`,
      );
      saveBlob(file.blob, file.filename ?? `monkey.${format}`);
      toast.success("Descarga lista");
      setOpen(false);
    } catch (error: unknown) {
      toast.error(
        error instanceof ApiError ? error.message : "No se pudo exportar",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="min-h-touch"
        disabled={spaceId === ""}
        onClick={() => {
          setOpen(true);
        }}
      >
        <Download className="size-4" />
        Exportar
      </Button>

      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>Exportar</DrawerTitle>
            <DrawerDescription>
              Movimientos con hojas de resumen por período, categoría y miembro.
            </DrawerDescription>
          </DrawerHeader>

          <DrawerBody className="space-y-6">
            <Section label="Qué exportar">
              <Chip
                active={scope === "period"}
                onClick={() => {
                  setScope("period");
                }}
              >
                Este período · {describeRange(range, locale)}
              </Chip>
              <Chip
                active={scope === "all"}
                onClick={() => {
                  setScope("all");
                }}
              >
                Todo el historial
              </Chip>
            </Section>

            {accounts.length > 1 && (
              <Section label="Cuenta">
                <Chip
                  active={accountId === null}
                  onClick={() => {
                    setAccountId(null);
                  }}
                >
                  Todas
                </Chip>
                {accounts.map((account) => (
                  <Chip
                    key={account.id}
                    active={accountId === account.id}
                    onClick={() => {
                      setAccountId(account.id);
                    }}
                  >
                    {account.name}
                  </Chip>
                ))}
              </Section>
            )}

            <Section label="Formato">
              <Chip
                active={format === "xlsx"}
                onClick={() => {
                  setFormat("xlsx");
                }}
              >
                Excel (.xlsx)
              </Chip>
              <Chip
                active={format === "csv"}
                onClick={() => {
                  setFormat("csv");
                }}
              >
                CSV
              </Chip>
            </Section>

            <p className="text-xs text-muted-foreground">
              {format === "xlsx"
                ? "Una hoja con los movimientos y otras con los totales por período, por categoría y por miembro."
                : "Una tabla plana, lista para volver a importar o para abrir en cualquier hoja de cálculo."}
            </p>

            <Button
              type="button"
              className="min-h-touch w-full"
              disabled={busy}
              onClick={() => {
                void download();
              }}
            >
              {busy ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <>
                  <Download className="size-4" />
                  Descargar
                </>
              )}
            </Button>
          </DrawerBody>
        </DrawerContent>
      </Drawer>
    </>
  );
}

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-3">
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </p>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "min-h-touch rounded-full border px-3 text-sm",
        active && "border-primary bg-primary text-primary-foreground",
      )}
    >
      {children}
    </button>
  );
}
