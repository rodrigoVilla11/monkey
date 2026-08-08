"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, Loader2, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError, api } from "@/lib/api-client";
import { useActiveSpace, useSession } from "@/lib/hooks/use-session";
import { spaceScopeKey } from "@/lib/query-keys";
import { cn } from "@/lib/utils";
import type { RatesResponse } from "@/shared/contracts/rates";
import { SUGGESTED_CURRENCIES } from "@/shared/currency";
import { formatCalendarDate } from "@/shared/dates";
import { hasAtLeast } from "@/shared/roles";

/**
 * Cotizaciones.
 *
 * La pantalla arranca por lo que FALTA, no por el formulario: nadie sabe de
 * memoria qué pares necesita la app. El servidor mira las monedas de las
 * cuentas del Space y dice exactamente cuáles cargar para que el inicio deje de
 * decir "no se pudo convertir".
 */
export default function RatesPage() {
  const session = useSession();
  const { space } = useActiveSpace();
  const spaceId = space?.id ?? "";

  const rates = useQuery({
    queryKey: [...spaceScopeKey(spaceId), "rates"],
    queryFn: () => api.get<RatesResponse>(`/spaces/${spaceId}/rates`),
    enabled: spaceId !== "",
  });

  const locale = session.data?.locale ?? "es-ES";
  const canEdit = space !== undefined && hasAtLeast(space.role, "MEMBER");
  const primary = space?.primaryCurrency ?? "EUR";

  return (
    <div className="space-y-4 py-3">
      <div>
        <h1 className="text-xl font-semibold">Cotizaciones</h1>
        <p className="mt-1 text-xs text-muted-foreground">
          Sirven para mostrar en {primary} lo que tenés en otras monedas. Los
          movimientos ya cargados NO cambian: cada uno guardó su cotización al
          crearse, para que un reporte de enero dé lo mismo hoy que en marzo.
        </p>
      </div>

      {rates.data === undefined ? (
        <Skeleton className="h-32 w-full rounded-xl" />
      ) : (
        <>
          {rates.data.missing.length > 0 && (
            <Card className="gap-2 border-expense/40 p-4">
              <span className="flex items-center gap-1.5 text-sm font-semibold">
                <AlertTriangle className="size-4 text-expense" />
                Faltan {rates.data.missing.length}
              </span>
              <p className="text-xs text-muted-foreground">
                Sin estas, el inicio no puede convertir y lo dice en vez de
                inventar un número.
              </p>
              <ul className="space-y-1 text-sm">
                {rates.data.missing.map((item) => (
                  <li
                    key={`${item.baseCurrency}-${item.quoteCurrency}`}
                    className="flex items-center gap-2"
                  >
                    <span className="font-medium tabular-nums">
                      {item.baseCurrency}
                      <ArrowRight className="mx-1 inline size-3" />
                      {item.quoteCurrency}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {item.reason}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {canEdit && (
            <NewRateCard
              spaceId={spaceId}
              primary={primary}
              suggested={rates.data.missing[0]}
            />
          )}

          <Card className="gap-2 p-4">
            <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Cargadas
            </span>
            {rates.data.rates.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Todavía no cargaste ninguna.
              </p>
            ) : (
              <ul className="divide-y">
                {rates.data.rates.map((rate) => (
                  <li
                    key={rate.id}
                    className="flex items-center gap-2 py-2 text-sm"
                  >
                    <span className="min-w-0 flex-1 truncate tabular-nums">
                      1 {rate.baseCurrency} = {rate.rate} {rate.quoteCurrency}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {formatCalendarDate(rate.date, locale, {
                        dateStyle: "short",
                      })}
                    </span>
                    {canEdit && <DeleteRate spaceId={spaceId} id={rate.id} />}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

function NewRateCard({
  spaceId,
  primary,
  suggested,
}: {
  spaceId: string;
  primary: string;
  suggested: RatesResponse["missing"][number] | undefined;
}) {
  const queryClient = useQueryClient();

  // Si falta alguna, el formulario arranca en ella: es lo que se viene a hacer.
  const [base, setBase] = useState(
    suggested?.baseCurrency ??
      SUGGESTED_CURRENCIES.find((c) => c !== primary) ??
      "USD",
  );
  const [rate, setRate] = useState("");

  const create = useMutation({
    mutationFn: () =>
      api.post(`/spaces/${spaceId}/rates`, {
        baseCurrency: base,
        quoteCurrency: primary,
        // Se manda con punto: el contrato espera un decimal, no un formato
        // local.
        rate: rate.replace(",", "."),
      }),
    onSuccess: () => {
      toast.success("Cotización cargada");
      setRate("");
      void queryClient.invalidateQueries({ queryKey: spaceScopeKey(spaceId) });
    },
    onError: (error: unknown) => {
      toast.error(
        error instanceof ApiError ? error.message : "No se pudo cargar",
      );
    },
  });

  const valid =
    /^\d+([.,]\d+)?$/.test(rate) && Number(rate.replace(",", ".")) > 0;

  return (
    <Card className="gap-3 p-4">
      <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        Cargar una
      </span>

      <div className="space-y-1.5">
        <Label>Moneda</Label>
        <div className="flex flex-wrap gap-2">
          {SUGGESTED_CURRENCIES.filter((option) => option !== primary).map(
            (option) => (
              <button
                key={option}
                type="button"
                onClick={() => {
                  setBase(option);
                }}
                aria-pressed={base === option}
                className={cn(
                  "min-h-touch rounded-full border px-3 text-sm tabular-nums",
                  base === option &&
                    "border-primary bg-primary text-primary-foreground",
                )}
              >
                {option}
              </button>
            ),
          )}
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="rate-value">
          1 {base} = ? {primary}
        </Label>
        <Input
          id="rate-value"
          value={rate}
          onChange={(e) => {
            setRate(e.target.value);
          }}
          placeholder="0,92"
          inputMode="decimal"
          className="min-h-touch"
        />
        <p className="text-xs text-muted-foreground">
          Se guarda con la fecha de hoy. Si volvés a cargar la misma moneda hoy,
          se reemplaza — corregir un número mal tecleado es lo normal.
        </p>
      </div>

      <Button
        className="min-h-touch w-full"
        disabled={!valid || create.isPending}
        onClick={() => {
          create.mutate();
        }}
      >
        {create.isPending ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          "Guardar"
        )}
      </Button>
    </Card>
  );
}

function DeleteRate({ spaceId, id }: { spaceId: string; id: string }) {
  const queryClient = useQueryClient();

  const remove = useMutation({
    mutationFn: () => api.delete(`/spaces/${spaceId}/rates/${id}`),
    onSuccess: () => {
      toast.success("Cotización eliminada");
      void queryClient.invalidateQueries({ queryKey: spaceScopeKey(spaceId) });
    },
  });

  return (
    <Button
      variant="ghost"
      size="icon"
      className="min-h-touch min-w-touch shrink-0 text-muted-foreground"
      aria-label="Eliminar cotización"
      onClick={() => {
        remove.mutate();
      }}
    >
      <Trash2 className="size-3.5" />
    </Button>
  );
}
