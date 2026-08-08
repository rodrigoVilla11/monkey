"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Users } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ApiError, api } from "@/lib/api-client";
import { formatMoneyDTO, initials } from "@/lib/format";
import { useMembers } from "@/lib/hooks/use-domain";
import { spaceScopeKey } from "@/lib/query-keys";
import { cn } from "@/lib/utils";
import type { TransactionSplitDTO } from "@/shared/contracts/splits";

/**
 * Reparto de un gasto.
 *
 * Solo aparece en Spaces compartidos: repartir un gasto con uno mismo no
 * significa nada, y una sección vacía prometiendo una función es ruido.
 *
 * El flujo es de dos toques: quién puso la plata y con quién se reparte. El
 * resto de los modos —porcentaje, importes exactos— vive en la API pero no en
 * esta pantalla: partes iguales es lo que se usa el 90 % de las veces, y meter
 * tres modos en un panel de móvil convierte dos toques en seis.
 */
export function SplitPanel({
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
  const members = useMembers(spaceId);

  const [editing, setEditing] = useState(false);
  const [payer, setPayer] = useState<string | null>(null);
  const [participants, setParticipants] = useState<string[]>([]);

  const split = useQuery({
    queryKey: [...spaceScopeKey(spaceId), "split", transactionId],
    queryFn: () =>
      api.get<{ split: TransactionSplitDTO }>(
        `/spaces/${spaceId}/transactions/${transactionId}/split`,
      ),
    select: (data) => data.split,
    enabled: spaceId !== "" && transactionId !== "",
  });

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: spaceScopeKey(spaceId) });
  };

  const save = useMutation({
    mutationFn: () =>
      api.put(`/spaces/${spaceId}/transactions/${transactionId}/split`, {
        paidByUserId: payer,
        mode: "EVEN",
        participants: participants.map((userId) => ({ userId })),
      }),
    onSuccess: () => {
      toast.success("Gasto repartido");
      setEditing(false);
      invalidate();
    },
    onError: (error: unknown) => {
      toast.error(
        error instanceof ApiError ? error.message : "No se pudo repartir",
      );
    },
  });

  const clear = useMutation({
    mutationFn: () =>
      api.delete(`/spaces/${spaceId}/transactions/${transactionId}/split`),
    onSuccess: () => {
      toast.success("Reparto quitado");
      invalidate();
    },
  });

  const all = members.data ?? [];
  const current = split.data;

  const startEditing = (): void => {
    setPayer(current?.paidBy?.userId ?? all[0]?.userId ?? null);
    setParticipants(
      current !== undefined && current.shares.length > 0
        ? current.shares.map((share) => share.userId)
        : all.map((member) => member.userId),
    );
    setEditing(true);
  };

  const toggle = (userId: string): void => {
    setParticipants((previous) =>
      previous.includes(userId)
        ? previous.filter((id) => id !== userId)
        : [...previous, userId],
    );
  };

  if (current === undefined) return null;

  return (
    <section className="space-y-2">
      <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        Reparto
      </h3>

      {!editing && current.shares.length > 0 && (
        <>
          {current.paidBy !== null && (
            <p className="text-xs text-muted-foreground">
              Puso la plata{" "}
              <span className="font-medium text-foreground">
                {current.paidBy.name}
              </span>
            </p>
          )}

          <ul className="space-y-1.5">
            {current.shares.map((share) => (
              <li
                key={share.userId}
                className="flex items-center gap-2 text-sm"
              >
                <Avatar className="size-6">
                  {share.avatarUrl !== null && (
                    <AvatarImage src={share.avatarUrl} alt="" />
                  )}
                  <AvatarFallback className="text-[10px]">
                    {initials(share.name)}
                  </AvatarFallback>
                </Avatar>
                <span className="min-w-0 flex-1 truncate">{share.name}</span>
                <span className="shrink-0 tabular-nums">
                  {formatMoneyDTO(share.amount, locale)}
                </span>
                <span className="w-12 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
                  {share.percentage.toFixed(0)}%
                </span>
              </li>
            ))}
          </ul>

          {canEdit && (
            <div className="flex gap-4">
              <button
                type="button"
                onClick={startEditing}
                className="min-h-touch text-xs text-muted-foreground"
              >
                Cambiar
              </button>
              <button
                type="button"
                onClick={() => {
                  clear.mutate();
                }}
                className="min-h-touch text-xs text-muted-foreground"
              >
                Quitar reparto
              </button>
            </div>
          )}
        </>
      )}

      {!editing && current.shares.length === 0 && canEdit && (
        <Button
          variant="outline"
          className="min-h-touch w-full"
          onClick={startEditing}
        >
          <Users className="size-4" />
          Repartir este gasto
        </Button>
      )}

      {!editing && current.shares.length === 0 && !canEdit && (
        <p className="text-xs text-muted-foreground">Sin repartir</p>
      )}

      {editing && (
        <div className="space-y-3 rounded-lg border p-3">
          <div className="space-y-1.5">
            <p className="text-xs text-muted-foreground">
              ¿Quién puso la plata?
            </p>
            <div className="flex flex-wrap gap-2">
              {all.map((member) => (
                <button
                  key={member.userId}
                  type="button"
                  onClick={() => {
                    setPayer(member.userId);
                  }}
                  aria-pressed={payer === member.userId}
                  className={cn(
                    "min-h-touch rounded-full border px-3 text-sm",
                    payer === member.userId &&
                      "border-primary bg-primary text-primary-foreground",
                  )}
                >
                  {member.name}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <p className="text-xs text-muted-foreground">
              ¿Entre quiénes se reparte?
            </p>
            <div className="flex flex-wrap gap-2">
              {all.map((member) => (
                <button
                  key={member.userId}
                  type="button"
                  onClick={() => {
                    toggle(member.userId);
                  }}
                  aria-pressed={participants.includes(member.userId)}
                  className={cn(
                    "min-h-touch rounded-full border px-3 text-sm",
                    participants.includes(member.userId) &&
                      "border-primary bg-primary text-primary-foreground",
                  )}
                >
                  {member.name}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              En partes iguales. Los céntimos que sobren van a la primera parte:
              la suma siempre da el importe exacto.
            </p>
          </div>

          <div className="flex gap-2">
            <Button
              className="min-h-touch flex-1"
              disabled={participants.length === 0 || save.isPending}
              onClick={() => {
                save.mutate();
              }}
            >
              {save.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                "Repartir"
              )}
            </Button>
            <Button
              variant="ghost"
              className="min-h-touch"
              onClick={() => {
                setEditing(false);
              }}
            >
              Cancelar
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
