"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Loader2, Scale, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError, api } from "@/lib/api-client";
import { formatMoneyDTO, initials } from "@/lib/format";
import { useActiveSpace, useSession } from "@/lib/hooks/use-session";
import { spaceScopeKey } from "@/lib/query-keys";
import { cn } from "@/lib/utils";
import type {
  SplitSummaryDTO,
  SuggestedPaymentDTO,
} from "@/shared/contracts/splits";
import { formatCalendarDate } from "@/shared/dates";
import { hasAtLeast } from "@/shared/roles";

/**
 * Quién le debe a quién.
 *
 * El orden de la pantalla es deliberado: primero **qué hacer** —los pagos
 * sugeridos— y después el detalle de los saldos. Quien abre esto viene a saber
 * cuánto le tiene que pasar a quién, no a leer un balance contable.
 */
export default function BalancesPage() {
  const session = useSession();
  const { space } = useActiveSpace();
  const spaceId = space?.id ?? "";

  const summary = useQuery({
    queryKey: [...spaceScopeKey(spaceId), "settlements"],
    queryFn: () =>
      api.get<{ summary: SplitSummaryDTO }>(`/spaces/${spaceId}/settlements`),
    select: (data) => data.summary,
    enabled: spaceId !== "",
  });

  const locale = session.data?.locale ?? "es-ES";
  const canEdit = space !== undefined && hasAtLeast(space.role, "MEMBER");
  const isShared = (space?.memberCount ?? 1) > 1;

  if (!isShared) {
    return (
      <div className="flex flex-col items-center gap-2 py-16 text-center text-muted-foreground">
        <Scale className="size-10 opacity-40" />
        <p className="text-sm">Este espacio es personal</p>
        <p className="max-w-xs text-xs">
          Repartir gastos tiene sentido cuando hay más de una persona. Invitá a
          alguien desde Ajustes.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4 py-3">
      <h1 className="text-xl font-semibold">Cuentas entre nosotros</h1>

      {summary.data === undefined ? (
        <div className="space-y-3">
          {Array.from({ length: 2 }, (_unused, i) => (
            <Skeleton key={i} className="h-28 w-full rounded-xl" />
          ))}
        </div>
      ) : summary.data.splitCount === 0 ? (
        <div className="flex flex-col items-center gap-2 py-16 text-center text-muted-foreground">
          <Scale className="size-10 opacity-40" />
          <p className="text-sm">Todavía no hay gastos repartidos</p>
          <p className="max-w-xs text-xs">
            Abrí un gasto desde Movimientos y elegí con quién repartirlo.
          </p>
        </div>
      ) : (
        <>
          <SuggestedCard
            summary={summary.data}
            spaceId={spaceId}
            locale={locale}
            canEdit={canEdit}
          />

          <Card className="gap-3 p-4">
            <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Detalle
            </span>
            <ul className="divide-y">
              {summary.data.balances.map((balance) => {
                const net = BigInt(balance.net.amountMinor);
                return (
                  <li
                    key={balance.userId}
                    className="flex items-center gap-3 py-2.5"
                  >
                    <Avatar className="size-8">
                      {balance.avatarUrl !== null && (
                        <AvatarImage src={balance.avatarUrl} alt="" />
                      )}
                      <AvatarFallback className="text-xs">
                        {initials(balance.name)}
                      </AvatarFallback>
                    </Avatar>

                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {balance.name}
                      </p>
                      {/* De dónde sale el número: un total sin desglose
                          invita a desconfiar. */}
                      <p className="text-xs text-muted-foreground tabular-nums">
                        puso {formatMoneyDTO(balance.paid, locale)} · le tocaba{" "}
                        {formatMoneyDTO(balance.owed, locale)}
                      </p>
                    </div>

                    <span
                      className={cn(
                        "shrink-0 text-sm font-semibold tabular-nums",
                        net > 0n && "text-income",
                        net < 0n && "text-expense",
                      )}
                    >
                      {net === 0n
                        ? "a mano"
                        : formatMoneyDTO(balance.net, locale, {
                            signDisplay: "always",
                          })}
                    </span>
                  </li>
                );
              })}
            </ul>
          </Card>

          {summary.data.settlements.length > 0 && (
            <Card className="gap-2 p-4">
              <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                Ya saldado
              </span>
              <ul className="divide-y">
                {summary.data.settlements.map((settlement) => (
                  <li
                    key={settlement.id}
                    className="flex items-center gap-2 py-2 text-sm"
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {settlement.from.name} → {settlement.to.name}
                    </span>
                    <span className="shrink-0 tabular-nums">
                      {formatMoneyDTO(settlement.amount, locale)}
                    </span>
                    <span className="w-20 shrink-0 text-right text-xs text-muted-foreground">
                      {formatCalendarDate(settlement.date, locale, {
                        dateStyle: "short",
                      })}
                    </span>
                    {canEdit && (
                      <UndoButton
                        spaceId={spaceId}
                        settlementId={settlement.id}
                      />
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function SuggestedCard({
  summary,
  spaceId,
  locale,
  canEdit,
}: {
  summary: SplitSummaryDTO;
  spaceId: string;
  locale: string;
  canEdit: boolean;
}) {
  if (summary.suggested.length === 0) {
    return (
      <Card className="items-center gap-1 p-6 text-center">
        <Scale className="size-8 text-income" />
        <p className="text-sm font-semibold">Están a mano</p>
        <p className="text-xs text-muted-foreground">
          Nadie le debe nada a nadie.
        </p>
      </Card>
    );
  }

  return (
    <Card className="gap-3 p-4">
      <div>
        <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Para quedar a mano
        </span>
        {/* Se dice por qué son estos y no otros: con cuatro personas y deudas
            cruzadas, son tres pagos en vez de seis. */}
        <p className="mt-0.5 text-xs text-muted-foreground">
          {summary.suggested.length === 1
            ? "Con este pago quedan en cero."
            : `Con estos ${String(summary.suggested.length)} pagos quedan en cero.`}
        </p>
      </div>

      <ul className="space-y-2">
        {summary.suggested.map((payment) => (
          <SuggestedRow
            key={`${payment.from.userId}-${payment.to.userId}`}
            payment={payment}
            spaceId={spaceId}
            locale={locale}
            canEdit={canEdit}
          />
        ))}
      </ul>
    </Card>
  );
}

function SuggestedRow({
  payment,
  spaceId,
  locale,
  canEdit,
}: {
  payment: SuggestedPaymentDTO;
  spaceId: string;
  locale: string;
  canEdit: boolean;
}) {
  const queryClient = useQueryClient();
  const [done, setDone] = useState(false);

  const settle = useMutation({
    mutationFn: () =>
      api.post(`/spaces/${spaceId}/settlements`, {
        fromUserId: payment.from.userId,
        toUserId: payment.to.userId,
        amountMinor: payment.amount.amountMinor,
      }),
    onSuccess: () => {
      setDone(true);
      toast.success("Saldado");
      void queryClient.invalidateQueries({ queryKey: spaceScopeKey(spaceId) });
    },
    onError: (error: unknown) => {
      toast.error(
        error instanceof ApiError ? error.message : "No se pudo registrar",
      );
    },
  });

  return (
    <li className="flex items-center gap-2 rounded-lg bg-secondary p-2.5">
      <span className="min-w-0 flex-1 truncate text-sm">
        <span className="font-medium">{payment.from.name}</span>
        <ArrowRight className="mx-1 inline size-3.5 text-muted-foreground" />
        <span className="font-medium">{payment.to.name}</span>
      </span>

      <span className="shrink-0 text-sm font-semibold tabular-nums">
        {formatMoneyDTO(payment.amount, locale)}
      </span>

      {canEdit && (
        <Button
          size="sm"
          variant="outline"
          className="min-h-touch shrink-0"
          disabled={settle.isPending || done}
          onClick={() => {
            settle.mutate();
          }}
        >
          {settle.isPending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            "Ya está"
          )}
        </Button>
      )}
    </li>
  );
}

function UndoButton({
  spaceId,
  settlementId,
}: {
  spaceId: string;
  settlementId: string;
}) {
  const queryClient = useQueryClient();

  const undo = useMutation({
    mutationFn: () =>
      api.delete(`/spaces/${spaceId}/settlements/${settlementId}`),
    onSuccess: () => {
      toast.success("Saldado deshecho");
      void queryClient.invalidateQueries({ queryKey: spaceScopeKey(spaceId) });
    },
  });

  return (
    <Button
      variant="ghost"
      size="icon"
      className="min-h-touch min-w-touch shrink-0 text-muted-foreground"
      aria-label="Deshacer este saldado"
      onClick={() => {
        undo.mutate();
      }}
    >
      <Trash2 className="size-3.5" />
    </Button>
  );
}
