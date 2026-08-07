"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Target, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError, api } from "@/lib/api-client";
import { formatMoneyDTO } from "@/lib/format";
import { useAccounts } from "@/lib/hooks/use-domain";
import { useActiveSpace, useSession } from "@/lib/hooks/use-session";
import { spaceScopeKey } from "@/lib/query-keys";
import { cn } from "@/lib/utils";
import type { SavingsGoalDTO } from "@/shared/contracts/savings";
import { getCurrencyExponent } from "@/shared/currency";
import { formatCalendarDate } from "@/shared/dates";
import { hasAtLeast } from "@/shared/roles";

/**
 * Metas de ahorro.
 *
 * Cada tarjeta responde tres preguntas en ese orden: cuánto llevo, cuánto falta
 * y si llego a tiempo. El "si llego" es lo que justifica poner una fecha; sin
 * eso la fecha sería decoración.
 */
export default function GoalsPage() {
  const session = useSession();
  const { space } = useActiveSpace();
  const spaceId = space?.id ?? "";
  const [showNew, setShowNew] = useState(false);
  const [showAchieved, setShowAchieved] = useState(false);

  const goals = useQuery({
    queryKey: [...spaceScopeKey(spaceId), "goals", showAchieved],
    queryFn: () =>
      api.get<{ goals: SavingsGoalDTO[] }>(
        `/spaces/${spaceId}/goals${showAchieved ? "?includeAchieved=true" : ""}`,
      ),
    select: (data) => data.goals,
    enabled: spaceId !== "",
  });

  const locale = session.data?.locale ?? "es-ES";
  const canEdit = space !== undefined && hasAtLeast(space.role, "MEMBER");

  return (
    <div className="space-y-4 py-3">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Metas</h1>
        {canEdit && (
          <Button
            size="sm"
            className="min-h-touch"
            onClick={() => {
              setShowNew(true);
            }}
          >
            <Plus className="size-4" />
            Nueva
          </Button>
        )}
      </div>

      <button
        type="button"
        onClick={() => {
          setShowAchieved(!showAchieved);
        }}
        aria-pressed={showAchieved}
        className="min-h-touch text-xs text-muted-foreground"
      >
        {showAchieved ? "Ver solo las pendientes" : "Ver también las logradas"}
      </button>

      {goals.data === undefined ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }, (_unused, i) => (
            <Skeleton key={i} className="h-32 w-full rounded-xl" />
          ))}
        </div>
      ) : goals.data.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-16 text-center text-muted-foreground">
          <Target className="size-10 opacity-40" />
          <p className="text-sm">Todavía no hay metas</p>
          <p className="max-w-xs text-xs">
            Un viaje, un colchón para imprevistos. Poné el objetivo y andá
            sumando lo que apartes.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {goals.data.map((goal) => (
            <GoalCard
              key={goal.id}
              goal={goal}
              spaceId={spaceId}
              locale={locale}
              canEdit={canEdit}
            />
          ))}
        </div>
      )}

      <NewGoalSheet
        open={showNew}
        onOpenChange={setShowNew}
        spaceId={spaceId}
        currency={space?.primaryCurrency ?? "EUR"}
      />
    </div>
  );
}

const PACE_LABEL: Record<SavingsGoalDTO["pace"], string> = {
  ACHIEVED: "Lograda",
  ON_TRACK: "En tiempo",
  BEHIND: "Atrasada",
  OVERDUE: "Se pasó la fecha",
};

function GoalCard({
  goal,
  spaceId,
  locale,
  canEdit,
}: {
  goal: SavingsGoalDTO;
  spaceId: string;
  locale: string;
  canEdit: boolean;
}) {
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState("");

  const invalidate = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: spaceScopeKey(spaceId) });
  };

  const contribute = useMutation({
    mutationFn: () =>
      api.post(`/spaces/${spaceId}/goals/${goal.id}/contributions`, {
        amountMinor: toMinor(amount, getCurrencyExponent(goal.target.currency)),
      }),
    onSuccess: async () => {
      toast.success("Aporte registrado");
      setAmount("");
      await invalidate();
    },
    onError: (error: unknown) => {
      toast.error(
        error instanceof ApiError ? error.message : "No se pudo registrar",
      );
    },
  });

  const remove = useMutation({
    mutationFn: () => api.delete(`/spaces/${spaceId}/goals/${goal.id}`),
    onSuccess: async () => {
      toast.success("Meta eliminada");
      await invalidate();
    },
  });

  const color = goal.color ?? "var(--primary)";
  const canContribute = /^\d+([.,]\d+)?$/.test(amount) && !contribute.isPending;

  return (
    <Card className="gap-3 p-4">
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-sm font-semibold">{goal.name}</span>
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
          {goal.percentage.toFixed(0)}%
        </span>
      </div>

      {/* Sin animación: compite con el scroll, que es lo que hay que cuidar. */}
      <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
        <div
          className="h-full rounded-full"
          style={{
            width: `${String(goal.percentage)}%`,
            backgroundColor: color,
          }}
        />
      </div>

      <div className="flex items-baseline justify-between text-sm tabular-nums">
        <span className="font-medium">
          {formatMoneyDTO(goal.saved, locale)}
        </span>
        <span className="text-xs text-muted-foreground">
          de {formatMoneyDTO(goal.target, locale)}
        </span>
      </div>

      {/* La respuesta a "¿llego?". Es lo que hace útil poner una fecha. */}
      <p className="text-xs text-muted-foreground">
        <span
          className={cn(
            "font-medium",
            goal.pace === "BEHIND" || goal.pace === "OVERDUE"
              ? "text-expense"
              : "text-income",
          )}
        >
          {PACE_LABEL[goal.pace]}
        </span>
        {goal.targetDate !== null && (
          <>
            {" · para el "}
            {formatCalendarDate(goal.targetDate, locale, {
              dateStyle: "medium",
            })}
          </>
        )}
        {goal.requiredPerMonth !== null && (
          <>
            {" · hacen falta "}
            {formatMoneyDTO(goal.requiredPerMonth, locale)}/mes
          </>
        )}
        {goal.achieved && goal.surplus.amountMinor !== "0" && (
          <> · {formatMoneyDTO(goal.surplus, locale)} de más</>
        )}
      </p>

      {canEdit && (
        <div className="flex items-center gap-2 border-t pt-3">
          <Input
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value);
            }}
            placeholder={`Aportar (${goal.target.currency})`}
            inputMode="decimal"
            aria-label={`Aportar a ${goal.name}`}
            className="min-h-touch flex-1"
          />
          <Button
            size="sm"
            className="min-h-touch"
            disabled={!canContribute}
            onClick={() => {
              contribute.mutate();
            }}
          >
            {contribute.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              "Sumar"
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="min-h-touch min-w-touch shrink-0 text-muted-foreground"
            aria-label={`Eliminar ${goal.name}`}
            onClick={() => {
              remove.mutate();
            }}
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      )}
    </Card>
  );
}

function NewGoalSheet({
  open,
  onOpenChange,
  spaceId,
  currency,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  spaceId: string;
  currency: string;
}) {
  const queryClient = useQueryClient();
  const accounts = useAccounts(spaceId);

  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [accountId, setAccountId] = useState<string | null>(null);

  const active = accounts.data?.filter((a) => !a.isArchived) ?? [];

  const create = useMutation({
    mutationFn: () =>
      api.post(`/spaces/${spaceId}/goals`, {
        name,
        targetAmountMinor: toMinor(target, getCurrencyExponent(currency)),
        accountId,
        ...(targetDate !== "" ? { targetDate } : {}),
      }),
    onSuccess: async () => {
      toast.success("Meta creada");
      setName("");
      setTarget("");
      setTargetDate("");
      setAccountId(null);
      onOpenChange(false);
      await queryClient.invalidateQueries({ queryKey: spaceScopeKey(spaceId) });
    },
    onError: (error: unknown) => {
      toast.error(
        error instanceof ApiError ? error.message : "No se pudo crear",
      );
    },
  });

  const canSave =
    name.trim() !== "" &&
    /^\d+([.,]\d+)?$/.test(target) &&
    Number(target.replace(",", ".")) > 0 &&
    !create.isPending;

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[90dvh] pb-safe-bottom">
        <DrawerHeader className="text-left">
          <DrawerTitle>Nueva meta</DrawerTitle>
        </DrawerHeader>

        <div className="app-scroll space-y-4 px-4 pb-6">
          <div className="space-y-1.5">
            <Label htmlFor="goal-name">Nombre</Label>
            <Input
              id="goal-name"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
              }}
              placeholder="Viaje a Japón"
              className="min-h-touch"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="goal-target">Objetivo ({currency})</Label>
            <Input
              id="goal-target"
              value={target}
              onChange={(e) => {
                setTarget(e.target.value);
              }}
              placeholder="3000"
              inputMode="decimal"
              className="min-h-touch"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="goal-date">¿Para cuándo? (opcional)</Label>
            <Input
              id="goal-date"
              type="date"
              value={targetDate}
              onChange={(e) => {
                setTargetDate(e.target.value);
              }}
              className="min-h-touch"
            />
            <p className="text-xs text-muted-foreground">
              Con fecha te decimos cuánto hace falta apartar por mes y si vas en
              tiempo.
            </p>
          </div>

          <div className="space-y-2">
            <Label>¿Dónde está la plata? (opcional)</Label>
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
            <p className="text-xs text-muted-foreground">
              Es solo para saber dónde mirar: el progreso lo marcan tus aportes,
              no el saldo de la cuenta.
            </p>
          </div>

          <Button
            className="min-h-touch w-full"
            disabled={!canSave}
            onClick={() => {
              create.mutate();
            }}
          >
            {create.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              "Crear meta"
            )}
          </Button>
        </div>
      </DrawerContent>
    </Drawer>
  );
}

/** Unidades mayores a mínimas con enteros, sin `parseFloat`. */
const toMinor = (input: string, exponent: number): string => {
  const [whole = "0", fraction = ""] = input.replace(",", ".").split(".");
  const padded = fraction.slice(0, exponent).padEnd(exponent, "0");
  return String(BigInt(`${whole === "" ? "0" : whole}${padded}`));
};
