"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Target, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError, api } from "@/lib/api-client";
import {
  formatMoneyDTO,
  isAmountInput,
  minorToInput,
  toMinor,
} from "@/lib/format";
import { useAccounts } from "@/lib/hooks/use-domain";
import { useActiveSpace, useSession } from "@/lib/hooks/use-session";
import { spaceScopeKey } from "@/lib/query-keys";
import { cn } from "@/lib/utils";
import type { SavingsGoalDTO } from "@/shared/contracts/savings";
import { getCurrencyExponent } from "@/shared/currency";
import { formatCalendarDate, todayIn } from "@/shared/dates";
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
  const [editing, setEditing] = useState<SavingsGoalDTO | null>(null);

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
              today={todayIn(session.data?.timezone ?? "Europe/Madrid")}
              onEdit={() => {
                setEditing(goal);
              }}
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

      {/**
       * Con `key` por meta: sin eso, abrir una segunda ficha reusaría el estado
       * del formulario de la primera y editarías la bici con los datos del
       * viaje.
       */}
      {editing !== null && (
        <EditGoalSheet
          key={editing.id}
          open
          onOpenChange={(value) => {
            if (!value) setEditing(null);
          }}
          spaceId={spaceId}
          goal={editing}
        />
      )}
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
  today,
  onEdit,
}: {
  goal: SavingsGoalDTO;
  spaceId: string;
  locale: string;
  canEdit: boolean;
  /** El plan arranca hoy, en la timezone de quien mira. */
  today: string;
  onEdit: () => void;
}) {
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState("");
  const [showOptions, setShowOptions] = useState(false);

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

  /**
   * Elegir una forma de llegar la GUARDA. Recalcularla sola cada día sería más
   * simple y no serviría para nada: sin un compromiso registrado nunca se
   * puede ir atrasado, porque el número se ajusta solo a lo que falta.
   */
  const choosePlan = useMutation({
    mutationFn: (plan: SavingsGoalDTO["planOptions"][number] | null) =>
      api.patch(`/spaces/${spaceId}/goals/${goal.id}`, {
        plan:
          plan === null
            ? null
            : {
                amountMinor: plan.amount.amountMinor,
                frequency: plan.frequency,
                interval: plan.interval,
                startDate: today,
              },
      }),
    onSuccess: async (_data, plan) => {
      toast.success(plan === null ? "Plan quitado" : "Listo, vas por acá");
      setShowOptions(false);
      await invalidate();
    },
    onError: (error: unknown) => {
      toast.error(
        error instanceof ApiError ? error.message : "No se pudo guardar",
      );
    },
  });

  const color = goal.color ?? "var(--primary)";
  const canContribute = /^\d+([.,]\d+)?$/.test(amount) && !contribute.isPending;

  const summary = (
    <>
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
    </>
  );

  return (
    <Card className="gap-3 p-4">
      {canEdit ? (
        // Todo el resumen abre la edición: un lápiz de 16px al costado es un
        // blanco imposible en un teléfono. El campo de aportar queda afuera
        // del botón porque es lo que se usa todos los días.
        <button
          type="button"
          onClick={onEdit}
          className="w-full space-y-3 text-left"
          aria-label={`Editar ${goal.name}`}
        >
          {summary}
        </button>
      ) : (
        <div className="space-y-3">{summary}</div>
      )}

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

      {/* El plan elegido: cuánto, cada cuánto y si se está cumpliendo. */}
      {goal.plan !== null && !goal.achieved && (
        <div className="space-y-1 rounded-lg bg-secondary/60 p-2.5">
          <p className="text-xs">
            <span className="font-medium">
              {formatMoneyDTO(goal.plan.amount, locale)}
            </span>{" "}
            <span className="text-muted-foreground lowercase">
              {goal.plan.description}
            </span>
          </p>

          <p className="text-xs">
            Te quedan{" "}
            <span className="font-medium">
              {goal.plan.remainingContributions}{" "}
              {goal.plan.remainingContributions === 1 ? "aporte" : "aportes"}
            </span>
            {goal.plan.nextDate !== null && (
              <>
                {" · el próximo el "}
                {formatCalendarDate(goal.plan.nextDate, locale, {
                  dateStyle: "medium",
                })}
              </>
            )}
          </p>

          {/* El atraso es contra lo que YA venció, no contra el objetivo. */}
          {goal.plan.behind.amountMinor !== "0" && (
            <p className="text-xs text-expense">
              Te falta apartar {formatMoneyDTO(goal.plan.behind, locale)} de lo
              que ibas a poner hasta hoy.
            </p>
          )}

          {canEdit && (
            <div className="flex gap-4 pt-1">
              <button
                type="button"
                onClick={() => {
                  setShowOptions(!showOptions);
                }}
                className="min-h-touch text-xs text-muted-foreground underline-offset-2 hover:underline"
              >
                Cambiar
              </button>
              <button
                type="button"
                disabled={choosePlan.isPending}
                onClick={() => {
                  choosePlan.mutate(null);
                }}
                className="min-h-touch text-xs text-muted-foreground underline-offset-2 hover:underline"
              >
                Quitar
              </button>
            </div>
          )}
        </div>
      )}

      {/**
       * Las formas de llegar. Detrás de un botón y no siempre abiertas: son
       * cuatro filas y la tarjeta es lo que se mira todos los días.
       */}
      {canEdit && !goal.achieved && goal.planOptions.length > 0 && (
        <div className="space-y-2">
          {goal.plan === null && (
            <button
              type="button"
              onClick={() => {
                setShowOptions(!showOptions);
              }}
              aria-expanded={showOptions}
              className="min-h-touch text-xs font-medium text-muted-foreground underline-offset-2 hover:underline"
            >
              {showOptions ? "Cerrar" : "¿Cómo llego?"}
            </button>
          )}

          {showOptions && (
            <div className="space-y-1.5">
              {goal.planOptions.map((option) => (
                <button
                  key={`${option.frequency}-${String(option.interval)}`}
                  type="button"
                  disabled={choosePlan.isPending}
                  onClick={() => {
                    choosePlan.mutate(option);
                  }}
                  className="flex w-full items-baseline justify-between gap-3 rounded-lg border px-3 py-2 text-left"
                >
                  <span className="text-sm font-medium tabular-nums">
                    {formatMoneyDTO(option.amount, locale)}{" "}
                    <span className="text-xs font-normal text-muted-foreground lowercase">
                      {option.description}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {option.count} {option.count === 1 ? "aporte" : "aportes"}
                  </span>
                </button>
              ))}
              <p className="text-xs text-muted-foreground">
                Salen de dividir lo que falta entre las veces que entran hasta
                la fecha, redondeando para arriba: cualquiera de las cuatro
                llega. Elegir una no mueve plata — sirve para recordarte y para
                saber si te estás quedando atrás.
              </p>
            </div>
          )}
        </div>
      )}

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

        <DrawerBody className="space-y-4">
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
        </DrawerBody>
      </DrawerContent>
    </Drawer>
  );
}

/**
 * Editar una meta.
 *
 * Se edita lo que puede cambiar de verdad: cómo se llama, cuánto es, para
 * cuándo y dónde está la plata. La moneda no —los aportes ya cargados están en
 * esa moneda y cambiarla los reinterpretaría en silencio—, y la pantalla lo
 * dice en vez de no ofrecerla y que parezca un olvido.
 *
 * Los aportes NO se tocan desde acá: bajar el objetivo por debajo de lo ya
 * apartado deja la meta lograda, que es lo que el servidor recalcula solo.
 */
function EditGoalSheet({
  open,
  onOpenChange,
  spaceId,
  goal,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  spaceId: string;
  goal: SavingsGoalDTO;
}) {
  const queryClient = useQueryClient();
  const session = useSession();
  const accounts = useAccounts(spaceId);
  const exponent = getCurrencyExponent(goal.target.currency);

  const [name, setName] = useState(goal.name);
  const [target, setTarget] = useState(
    minorToInput(goal.target.amountMinor, exponent),
  );
  const [targetDate, setTargetDate] = useState(goal.targetDate ?? "");
  const [accountId, setAccountId] = useState<string | null>(
    goal.account?.id ?? null,
  );

  const active = accounts.data?.filter((a) => !a.isArchived) ?? [];

  const invalidate = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: spaceScopeKey(spaceId) });
  };

  const save = useMutation({
    mutationFn: () =>
      api.patch(`/spaces/${spaceId}/goals/${goal.id}`, {
        name,
        targetAmountMinor: toMinor(target, exponent),
        accountId,
        // `null` explícito y no omitido: así se puede SACAR una fecha que ya no
        // aplica, que es la mitad de para qué sirve editar.
        targetDate: targetDate === "" ? null : targetDate,
      }),
    onSuccess: async () => {
      toast.success("Meta actualizada");
      onOpenChange(false);
      await invalidate();
    },
    onError: (error: unknown) => {
      toast.error(
        error instanceof ApiError ? error.message : "No se pudo guardar",
      );
    },
  });

  const remove = useMutation({
    mutationFn: () => api.delete(`/spaces/${spaceId}/goals/${goal.id}`),
    onSuccess: async () => {
      toast.success("Meta eliminada");
      onOpenChange(false);
      await invalidate();
    },
    onError: (error: unknown) => {
      toast.error(
        error instanceof ApiError ? error.message : "No se pudo eliminar",
      );
    },
  });

  const busy = save.isPending || remove.isPending;
  const canSave =
    name.trim() !== "" &&
    isAmountInput(target) &&
    Number(target.replace(",", ".")) > 0 &&
    !busy;

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[90dvh] pb-safe-bottom">
        <DrawerHeader className="text-left">
          <DrawerTitle>{goal.name}</DrawerTitle>
        </DrawerHeader>

        <DrawerBody className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="edit-goal-name">Nombre</Label>
            <Input
              id="edit-goal-name"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
              }}
              className="min-h-touch"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="edit-goal-target">
              Objetivo ({goal.target.currency})
            </Label>
            <Input
              id="edit-goal-target"
              value={target}
              onChange={(e) => {
                setTarget(e.target.value);
              }}
              inputMode="decimal"
              className="min-h-touch"
            />
            <p className="text-xs text-muted-foreground">
              Llevás{" "}
              {formatMoneyDTO(goal.saved, session.data?.locale ?? "es-ES")}{" "}
              apartados en {goal.contributionCount}{" "}
              {goal.contributionCount === 1 ? "aporte" : "aportes"}, y no se
              tocan: si bajás el objetivo por debajo de eso, la meta queda
              lograda.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="edit-goal-date">¿Para cuándo? (opcional)</Label>
            <Input
              id="edit-goal-date"
              type="date"
              value={targetDate}
              onChange={(e) => {
                setTargetDate(e.target.value);
              }}
              className="min-h-touch"
            />
            <p className="text-xs text-muted-foreground">
              {goal.plan === null
                ? "Cambiarla cambia las formas de llegar que te propone la tarjeta."
                : "El plan que elegiste no se mueve solo al cambiarla: si la adelantás, tocá “Cambiar” en la tarjeta para ver los números nuevos."}
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
                    setAccountId(account.id === accountId ? null : account.id);
                  }}
                  aria-pressed={account.id === accountId}
                  className={cn(
                    "min-h-touch shrink-0 rounded-xl border px-3 py-2 text-sm",
                    account.id === accountId && "ring-2 ring-primary",
                  )}
                >
                  {account.name}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Es contexto, no la fuente del progreso: el avance son los aportes
              que cargás, no el saldo de la cuenta.
            </p>
          </div>

          <p className="text-xs text-muted-foreground">
            La moneda no se puede cambiar: los aportes ya cargados están en{" "}
            {goal.target.currency} y cambiarla los reinterpretaría en silencio.
          </p>

          <Button
            className="min-h-touch w-full"
            disabled={!canSave}
            onClick={() => {
              save.mutate();
            }}
          >
            {save.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              "Guardar cambios"
            )}
          </Button>

          <Button
            variant="ghost"
            className="min-h-touch w-full text-expense"
            disabled={busy}
            onClick={() => {
              remove.mutate();
            }}
          >
            <Trash2 className="size-4" />
            Eliminar la meta y sus aportes
          </Button>
        </DrawerBody>
      </DrawerContent>
    </Drawer>
  );
}
