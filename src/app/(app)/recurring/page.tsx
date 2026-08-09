"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarClock,
  Loader2,
  Pause,
  Play,
  Plus,
  Trash2,
} from "lucide-react";
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
import { DynamicIcon } from "@/components/ui/dynamic-icon";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { ApiError, api } from "@/lib/api-client";
import { formatMoneyDTO, toMinor } from "@/lib/format";
import { useAccounts, useCategories } from "@/lib/hooks/use-domain";
import { useActiveSpace, useSession } from "@/lib/hooks/use-session";
import { spaceScopeKey } from "@/lib/query-keys";
import { cn } from "@/lib/utils";
import {
  RECURRENCE_FREQUENCIES,
  type RecurringRuleDTO,
} from "@/shared/contracts/recurring";
import { getCurrencyExponent } from "@/shared/currency";
import { formatCalendarDate, todayIn } from "@/shared/dates";
import { hasAtLeast } from "@/shared/roles";

const FREQUENCY_LABELS: Record<
  (typeof RECURRENCE_FREQUENCIES)[number],
  string
> = {
  DAILY: "Diario",
  WEEKLY: "Semanal",
  MONTHLY: "Mensual",
  YEARLY: "Anual",
};

/**
 * Movimientos programados.
 *
 * La pantalla no materializa nada: eso lo hace el job. Lo que muestra es la
 * INSTRUCCIÓN y cuándo se va a ejecutar, y por eso el dato más grande de cada
 * tarjeta es la próxima fecha — es lo que uno viene a mirar.
 */
export default function RecurringPage() {
  const session = useSession();
  const { space } = useActiveSpace();
  const spaceId = space?.id ?? "";
  const [showNew, setShowNew] = useState(false);
  const [showInactive, setShowInactive] = useState(false);

  const rules = useQuery({
    queryKey: [...spaceScopeKey(spaceId), "recurring", showInactive],
    queryFn: () =>
      api.get<{ rules: RecurringRuleDTO[] }>(
        `/spaces/${spaceId}/recurring${showInactive ? "?includeInactive=true" : ""}`,
      ),
    select: (data) => data.rules,
    enabled: spaceId !== "",
  });

  const locale = session.data?.locale ?? "es-ES";
  const canEdit = space !== undefined && hasAtLeast(space.role, "MEMBER");

  return (
    <div className="space-y-4 py-3">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Programados</h1>
        {canEdit && (
          <Button
            size="sm"
            className="min-h-touch"
            onClick={() => {
              setShowNew(true);
            }}
          >
            <Plus className="size-4" />
            Nuevo
          </Button>
        )}
      </div>

      <button
        type="button"
        onClick={() => {
          setShowInactive(!showInactive);
        }}
        aria-pressed={showInactive}
        className="min-h-touch text-xs text-muted-foreground"
      >
        {showInactive ? "Ver solo los activos" : "Ver también los pausados"}
      </button>

      {rules.data === undefined ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }, (_unused, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-xl" />
          ))}
        </div>
      ) : rules.data.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-16 text-center text-muted-foreground">
          <CalendarClock className="size-10 opacity-40" />
          <p className="text-sm">No hay movimientos programados</p>
          <p className="max-w-xs text-xs">
            El alquiler, el sueldo, la cuota del gimnasio: lo que se repite se
            carga una vez y aparece solo.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {rules.data.map((rule) => (
            <RuleCard
              key={rule.id}
              rule={rule}
              spaceId={spaceId}
              locale={locale}
              canEdit={canEdit}
            />
          ))}
        </div>
      )}

      <NewRuleSheet
        open={showNew}
        onOpenChange={setShowNew}
        spaceId={spaceId}
      />
    </div>
  );
}

function RuleCard({
  rule,
  spaceId,
  locale,
  canEdit,
}: {
  rule: RecurringRuleDTO;
  spaceId: string;
  locale: string;
  canEdit: boolean;
}) {
  const queryClient = useQueryClient();
  const invalidate = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: spaceScopeKey(spaceId) });
  };

  const toggle = useMutation({
    mutationFn: () =>
      api.patch(`/spaces/${spaceId}/recurring/${rule.id}`, {
        isActive: !rule.isActive,
      }),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: () => api.delete(`/spaces/${spaceId}/recurring/${rule.id}`),
    onSuccess: async () => {
      toast.success("Programado eliminado");
      await invalidate();
    },
  });

  const color = rule.category?.color ?? "#71717a";

  return (
    <Card className={cn("p-4", !rule.isActive && "opacity-60")}>
      <div className="flex items-start gap-3">
        <span
          className="flex size-10 shrink-0 items-center justify-center rounded-full"
          style={{ backgroundColor: `${color}26` }}
        >
          <DynamicIcon
            name={rule.category?.icon}
            className="size-4.5"
            style={{ color }}
          />
        </span>

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">
            {rule.description ?? rule.category?.name ?? "Sin descripción"}
          </p>
          <p className="text-xs text-muted-foreground">{rule.summary}</p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {rule.account.name}
            {!rule.autoPost && " · nace pendiente de revisar"}
          </p>
        </div>

        <span
          className={cn(
            "shrink-0 text-sm font-semibold tabular-nums",
            rule.type === "INCOME" ? "text-income" : "text-expense",
          )}
        >
          {rule.type === "INCOME" ? "+" : "−"}
          {formatMoneyDTO(rule.amount, locale)}
        </span>
      </div>

      {/* La próxima fecha es lo que uno viene a mirar acá. */}
      <p className="mt-3 border-t pt-3 text-xs">
        {rule.nextRunDate === null ? (
          <span className="text-muted-foreground">
            {rule.isActive ? "Sin próximas ocurrencias" : "Pausado"}
          </span>
        ) : (
          <>
            <span className="text-muted-foreground">Próximo: </span>
            <span className="font-medium">
              {formatCalendarDate(rule.nextRunDate, locale, {
                dateStyle: "medium",
              })}
            </span>
          </>
        )}
        {/**
         * Con tope, lo que importa es cuánto falta —"quedan 2 de 12"— y no
         * cuántos se generaron: nadie programa una cuota para saber cuántas
         * pagó, sino cuántas le quedan. Sin tope se sigue contando lo generado,
         * que es lo único que hay para decir.
         */}
        {rule.maxOccurrences === null
          ? rule.occurrencesCreated > 0 && (
              <span className="text-muted-foreground">
                {" "}
                · {rule.occurrencesCreated} generados
              </span>
            )
          : (() => {
              const left = Math.max(
                0,
                rule.maxOccurrences - rule.occurrencesCreated,
              );

              return (
                <span className="text-muted-foreground">
                  {" · "}
                  {left === 0
                    ? `terminado, ${String(rule.maxOccurrences)} generados`
                    : `quedan ${String(left)} de ${String(rule.maxOccurrences)}`}
                </span>
              );
            })()}
      </p>

      {canEdit && (
        <div className="mt-2 flex gap-4">
          <button
            type="button"
            onClick={() => {
              toggle.mutate();
            }}
            className="flex min-h-touch items-center gap-1.5 text-xs text-muted-foreground"
          >
            {rule.isActive ? (
              <Pause className="size-3.5" />
            ) : (
              <Play className="size-3.5" />
            )}
            {rule.isActive ? "Pausar" : "Reanudar"}
          </button>

          <button
            type="button"
            onClick={() => {
              remove.mutate();
            }}
            className="flex min-h-touch items-center gap-1.5 text-xs text-muted-foreground"
          >
            <Trash2 className="size-3.5" />
            Eliminar
          </button>
        </div>
      )}
    </Card>
  );
}

function NewRuleSheet({
  open,
  onOpenChange,
  spaceId,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  spaceId: string;
}) {
  const queryClient = useQueryClient();
  const session = useSession();
  const timezone = session.data?.timezone ?? "Europe/Madrid";

  const [type, setType] = useState<"EXPENSE" | "INCOME">("EXPENSE");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [accountId, setAccountId] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [frequency, setFrequency] =
    useState<(typeof RECURRENCE_FREQUENCIES)[number]>("MONTHLY");
  const [startDate, setStartDate] = useState("");
  const [autoPost, setAutoPost] = useState(true);
  const [times, setTimes] = useState<string | null>(null);

  const accounts = useAccounts(spaceId);
  const categories = useCategories(spaceId, type);

  const active = accounts.data?.filter((a) => !a.isArchived) ?? [];
  // Sin elección explícita manda la principal, igual que al cargar un
  // movimiento suelto.
  const account =
    active.find((a) => a.id === accountId) ??
    active.find((a) => a.isDefault) ??
    active[0] ??
    null;
  const currency = account?.currency ?? "EUR";
  const exponent = getCurrencyExponent(currency);
  const effectiveStart = startDate === "" ? todayIn(timezone) : startDate;

  const create = useMutation({
    mutationFn: () =>
      api.post(`/spaces/${spaceId}/recurring`, {
        accountId: account?.id,
        categoryId,
        type,
        amountMinor: toMinor(amount, exponent),
        frequency,
        interval: 1,
        startDate: effectiveStart,
        autoPost,
        isActive: true,
        ...(description.trim() !== ""
          ? { description: description.trim() }
          : {}),
        // `null` = indefinido, que es lo que la columna ya significaba.
        ...(times !== null && times !== ""
          ? { maxOccurrences: Number(times) }
          : {}),
        // El día del mes sale de la fecha de inicio: pedirlo aparte sería
        // pedir dos veces lo mismo y dejar que se contradigan.
        ...(frequency === "MONTHLY" || frequency === "YEARLY"
          ? { byMonthDay: Number(effectiveStart.slice(8, 10)) }
          : {}),
      }),
    onSuccess: async () => {
      toast.success("Movimiento programado");
      setAmount("");
      setDescription("");
      setCategoryId(null);
      setTimes(null);
      onOpenChange(false);
      await queryClient.invalidateQueries({ queryKey: spaceScopeKey(spaceId) });
    },
    onError: (error: unknown) => {
      toast.error(
        error instanceof ApiError ? error.message : "No se pudo programar",
      );
    },
  });

  const canSave =
    account !== null &&
    /^\d+([.,]\d+)?$/.test(amount) &&
    Number(amount.replace(",", ".")) > 0 &&
    // Con "un número de veces" elegido pero vacío no se guarda: sería un
    // límite que nadie puso.
    (times === null || (times !== "" && Number(times) > 0)) &&
    !create.isPending;

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[90dvh] pb-safe-bottom">
        <DrawerHeader className="text-left">
          <DrawerTitle>Nuevo programado</DrawerTitle>
        </DrawerHeader>

        <DrawerBody className="space-y-4">
          <div className="flex rounded-full bg-secondary p-1">
            {(["EXPENSE", "INCOME"] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => {
                  setType(option);
                  setCategoryId(null);
                }}
                className={cn(
                  "min-h-touch flex-1 rounded-full text-sm font-medium",
                  type === option
                    ? option === "EXPENSE"
                      ? "bg-expense text-expense-foreground"
                      : "bg-income text-income-foreground"
                    : "text-muted-foreground",
                )}
              >
                {option === "EXPENSE" ? "Gasto" : "Ingreso"}
              </button>
            ))}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="rule-amount">Importe ({currency})</Label>
            <Input
              id="rule-amount"
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value);
              }}
              placeholder="950"
              inputMode="decimal"
              className="min-h-touch"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="rule-description">Descripción</Label>
            <Input
              id="rule-description"
              value={description}
              onChange={(e) => {
                setDescription(e.target.value);
              }}
              placeholder="Alquiler"
              className="min-h-touch"
            />
          </div>

          <div className="space-y-2">
            <Label>Frecuencia</Label>
            <div className="flex flex-wrap gap-2">
              {RECURRENCE_FREQUENCIES.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => {
                    setFrequency(option);
                  }}
                  aria-pressed={frequency === option}
                  className={cn(
                    "min-h-touch rounded-full border px-3 text-sm",
                    frequency === option &&
                      "border-primary bg-primary text-primary-foreground",
                  )}
                >
                  {FREQUENCY_LABELS[option]}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="rule-start">Primera vez</Label>
            <Input
              id="rule-start"
              type="date"
              value={effectiveStart}
              onChange={(e) => {
                setStartDate(e.target.value);
              }}
              className="min-h-touch"
            />
            <p className="text-xs text-muted-foreground">
              Si ponés una fecha pasada, se generan también las que ya
              vencieron, cada una con su fecha.
            </p>
          </div>

          {/**
           * El sueldo y el alquiler no se terminan; las cuotas de la tarjeta
           * sí. Sin esta pregunta las dos cosas se anotaban igual y había que
           * acordarse de ir a borrar la regla el día que dejara de aplicar.
           */}
          <div className="space-y-2">
            <Label>¿Hasta cuándo?</Label>
            <div className="flex flex-wrap gap-2">
              {[
                { label: "Indefinido", value: null },
                { label: "Un número de veces", value: "" },
              ].map((option) => {
                const active = (times === null) === (option.value === null);

                return (
                  <button
                    key={option.label}
                    type="button"
                    onClick={() => {
                      setTimes(option.value);
                    }}
                    aria-pressed={active}
                    className={cn(
                      "min-h-touch rounded-full border px-3 text-sm",
                      active &&
                        "border-primary bg-primary text-primary-foreground",
                    )}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>

            {times === null ? (
              <p className="text-xs text-muted-foreground">
                Se repite hasta que lo pauses. Es lo que querés para un sueldo o
                un alquiler.
              </p>
            ) : (
              <>
                <Input
                  value={times}
                  onChange={(e) => {
                    setTimes(e.target.value.replace(/\D/g, ""));
                  }}
                  placeholder="3"
                  inputMode="numeric"
                  aria-label="Cuántas veces"
                  className="min-h-touch"
                />
                <p className="text-xs text-muted-foreground">
                  Las que FALTAN, no las del acuerdo: si de las doce de la
                  tarjeta ya pagaste nueve, poné 3. Cuando se generen todas, la
                  regla se termina sola.
                </p>
              </>
            )}
          </div>

          <div className="space-y-2">
            <Label>Cuenta</Label>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {active.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => {
                    setAccountId(option.id);
                  }}
                  aria-pressed={option.id === account?.id}
                  className={cn(
                    "min-h-touch shrink-0 rounded-xl border px-3 py-2 text-sm",
                    option.id === account?.id && "ring-2 ring-primary",
                  )}
                >
                  {option.name}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label>Categoría</Label>
            <div className="flex flex-wrap gap-2">
              {(categories.data ?? []).map((category) => (
                <button
                  key={category.id}
                  type="button"
                  onClick={() => {
                    setCategoryId(
                      categoryId === category.id ? null : category.id,
                    );
                  }}
                  aria-pressed={categoryId === category.id}
                  className={cn(
                    "min-h-touch rounded-full border px-3 text-sm",
                    categoryId === category.id &&
                      "border-primary bg-primary text-primary-foreground",
                  )}
                >
                  {category.name}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
            <div className="min-w-0">
              <Label htmlFor="rule-autopost">Dar por hecho</Label>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Activado, el movimiento nace confirmado. Desactivado, queda
                pendiente para que lo revises.
              </p>
            </div>
            <Switch
              id="rule-autopost"
              checked={autoPost}
              onCheckedChange={setAutoPost}
            />
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
              "Programar"
            )}
          </Button>
        </DrawerBody>
      </DrawerContent>
    </Drawer>
  );
}
