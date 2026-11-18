"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarClock,
  Check,
  Loader2,
  Pause,
  Pencil,
  Play,
  Plus,
  Trash2,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { AcceptRuleDrawer } from "@/components/recurring/accept-rule-drawer";
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
import type { CategoryTreeNode } from "@/shared/contracts/categories";
import {
  RECURRENCE_FREQUENCIES,
  type RecurringRuleDTO,
  type UpdateRecurringRuleRequest,
} from "@/shared/contracts/recurring";
import { getCurrencyExponent } from "@/shared/currency";
import {
  addDays,
  addMonths,
  formatCalendarDate,
  todayIn,
} from "@/shared/dates";
import { money, toDecimalString } from "@/shared/money";
import { scheduledTotals } from "@/shared/recurring-totals";
import { hasAtLeast } from "@/shared/roles";

type Frequency = (typeof RECURRENCE_FREQUENCIES)[number];

const FREQUENCY_LABELS: Record<Frequency, string> = {
  DAILY: "Diario",
  WEEKLY: "Semanal",
  MONTHLY: "Mensual",
  YEARLY: "Anual",
};

/**
 * Ventanas del resumen. Son rangos móviles desde hoy y no meses de calendario
 * a propósito: la pregunta que contesta esta pantalla es "qué se viene", y un
 * día 25 "este mes" son cinco días, no un mes.
 */
const PERIODS = [
  { months: 1, chip: "1 mes", heading: "el próximo mes" },
  { months: 3, chip: "3 meses", heading: "los próximos 3 meses" },
  { months: 12, chip: "12 meses", heading: "los próximos 12 meses" },
] as const;

/** Lo que se muestra como nombre de una regla. */
const ruleTitle = (rule: RecurringRuleDTO): string =>
  rule.description ?? rule.category?.name ?? "Sin descripción";

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
  const [period, setPeriod] = useState<(typeof PERIODS)[number]>(PERIODS[0]);

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
  const timezone = session.data?.timezone ?? space?.timezone ?? "Europe/Madrid";
  const canEdit = space !== undefined && hasAtLeast(space.role, "MEMBER");

  const primaryCurrency = space?.primaryCurrency ?? "EUR";
  const rulesData = rules.data;
  const totals = useMemo(() => {
    if (rulesData === undefined) return [];

    // Ventana inclusiva: hoy + N meses − 1 día son exactamente N meses.
    const until = addDays(addMonths(todayIn(timezone), period.months), -1);

    return scheduledTotals(rulesData, until, primaryCurrency);
  }, [rulesData, period.months, timezone, primaryCurrency]);

  const singleCurrency = totals.length === 1 ? totals[0] : undefined;

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

      {/**
       * Cuánto se viene, antes de la lista. La lista dice qué hay programado;
       * esto dice cuánto pesa, que es la otra mitad de la pregunta.
       */}
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {PERIODS.map((option) => (
            <button
              key={option.months}
              type="button"
              onClick={() => {
                setPeriod(option);
              }}
              aria-pressed={option.months === period.months}
              className={cn(
                "min-h-touch rounded-full border px-3 text-sm",
                option.months === period.months &&
                  "border-primary bg-primary text-primary-foreground",
              )}
            >
              {option.chip}
            </button>
          ))}
        </div>

        {rules.data === undefined ? (
          <Skeleton className="h-20 w-full rounded-xl" />
        ) : totals.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Nada programado para {period.heading}.
          </p>
        ) : (
          totals.map((total) => (
            <div key={total.currency} className="grid grid-cols-2 gap-3">
              <Card className="gap-1 p-4">
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <TrendingUp className="size-3.5 text-income" />
                  Ingresos
                  {totals.length > 1 && ` · ${total.currency}`}
                </span>
                <span className="text-lg font-semibold text-income tabular-nums">
                  {formatMoneyDTO(total.income, locale)}
                </span>
              </Card>
              <Card className="gap-1 p-4">
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <TrendingDown className="size-3.5 text-expense" />
                  Egresos
                  {totals.length > 1 && ` · ${total.currency}`}
                </span>
                <span className="text-lg font-semibold text-expense tabular-nums">
                  {formatMoneyDTO(total.expense, locale)}
                </span>
              </Card>
            </div>
          ))
        )}

        {totals.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Lo que falta generar en {period.heading}
            {/* El neto solo tiene sentido con una moneda: restar pesos a euros
                no da un número, da una confusión. */}
            {singleCurrency !== undefined && (
              <>
                {" · neto "}
                <span
                  className={cn(
                    "font-medium tabular-nums",
                    BigInt(singleCurrency.net.amountMinor) < 0n
                      ? "text-expense"
                      : "text-income",
                  )}
                >
                  {formatMoneyDTO(singleCurrency.net, locale, {
                    signDisplay: "always",
                  })}
                </span>
              </>
            )}
          </p>
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
              today={todayIn(timezone)}
            />
          ))}
        </div>
      )}

      <RuleSheet open={showNew} onOpenChange={setShowNew} spaceId={spaceId} />
    </div>
  );
}

function RuleCard({
  rule,
  spaceId,
  locale,
  canEdit,
  today,
}: {
  rule: RecurringRuleDTO;
  spaceId: string;
  locale: string;
  canEdit: boolean;
  today: string;
}) {
  const queryClient = useQueryClient();
  const invalidate = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: spaceScopeKey(spaceId) });
  };

  const [editing, setEditing] = useState(false);
  // Cambia cada vez que se abre: así la hoja arranca con los datos actuales de
  // la regla y no con los de la primera vez que se editó.
  const [editSession, setEditSession] = useState(0);
  const [choosingAccount, setChoosingAccount] = useState(false);

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

  const accept = useMutation({
    mutationFn: () =>
      api.post<{ created: number }>(
        `/spaces/${spaceId}/recurring/${rule.id}/materialize`,
      ),
    onSuccess: async (data) => {
      // `created: 0` puede pasar si el cron o el barrido del inicio se
      // adelantaron entre que se pintó el botón y el toque. No es un error.
      toast.success(
        data.created === 0
          ? "Ya estaba generado"
          : data.created === 1
            ? "Movimiento aceptado"
            : `${String(data.created)} movimientos aceptados`,
      );
      await invalidate();
    },
    onError: (error: unknown) => {
      toast.error(
        error instanceof ApiError ? error.message : "No se pudo aceptar",
      );
    },
  });

  /**
   * "Aceptar" solo aparece cuando la regla ya venció: el día que dice (o
   * antes, si quedó atrasada). Aceptar antes de fecha registraría plata que
   * todavía no se movió.
   */
  const isDue =
    rule.isActive && rule.nextRunDate !== null && rule.nextRunDate <= today;

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
          <p className="truncate text-sm font-medium">{ruleTitle(rule)}</p>
          <p className="text-xs text-muted-foreground">{rule.summary}</p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {rule.account === null
              ? "La cuenta se elige al aceptar"
              : rule.account.name}
            {rule.account !== null &&
              !rule.autoPost &&
              " · nace pendiente de revisar"}
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
            <span className="text-muted-foreground">
              {!isDue
                ? "Próximo: "
                : rule.nextRunDate === today
                  ? "Vence hoy: "
                  : "Venció: "}
            </span>
            <span className={cn("font-medium", isDue && "text-expense")}>
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
        <div className="mt-2 flex flex-wrap gap-4">
          {isDue && (
            <button
              type="button"
              disabled={accept.isPending}
              onClick={() => {
                // Sin cuenta, aceptar es elegirla: se abre el selector.
                if (rule.account === null) setChoosingAccount(true);
                else accept.mutate();
              }}
              className="flex min-h-touch items-center gap-1.5 text-xs font-medium text-primary disabled:opacity-40"
            >
              {accept.isPending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Check className="size-3.5" />
              )}
              {rule.account === null ? "Elegir cuenta y aceptar" : "Aceptar"}
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              setEditSession((value) => value + 1);
              setEditing(true);
            }}
            className="flex min-h-touch items-center gap-1.5 text-xs text-muted-foreground"
          >
            <Pencil className="size-3.5" />
            Editar
          </button>

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

      {canEdit && (
        <RuleSheet
          key={editSession}
          open={editing}
          onOpenChange={setEditing}
          spaceId={spaceId}
          rule={rule}
        />
      )}

      {canEdit && rule.account === null && (
        <AcceptRuleDrawer
          open={choosingAccount}
          onOpenChange={setChoosingAccount}
          spaceId={spaceId}
          locale={locale}
          rule={{ id: rule.id, title: ruleTitle(rule), amount: rule.amount }}
        />
      )}
    </Card>
  );
}

/**
 * Lo que cambió respecto de la regla guardada, y nada más.
 *
 * Mandar el formulario entero reanclaría la serie en cada edición —tocar la
 * descripción recalcularía `nextRunDate`— y obligaría al servidor a adivinar
 * qué quiso cambiar quien editó. Con el diff, cambiar el importe es cambiar el
 * importe.
 */
const buildPatch = (
  rule: RecurringRuleDTO,
  form: {
    amountMinor: string;
    description: string | null;
    categoryId: string | null;
    accountId: string | null;
    frequency: Frequency;
    startDate: string;
    maxOccurrences: number | null;
    autoPost: boolean;
  },
): UpdateRecurringRuleRequest => {
  const patch: UpdateRecurringRuleRequest = {};

  if (form.amountMinor !== rule.amount.amountMinor) {
    patch.amountMinor = form.amountMinor;
  }
  if (form.description !== rule.description) {
    patch.description = form.description;
  }
  if (form.categoryId !== (rule.category?.id ?? null)) {
    patch.categoryId = form.categoryId;
  }
  if (form.accountId !== (rule.account?.id ?? null)) {
    patch.accountId = form.accountId;
  }
  if (form.frequency !== rule.frequency) patch.frequency = form.frequency;
  if (form.startDate !== rule.startDate) patch.startDate = form.startDate;
  if (patch.frequency !== undefined || patch.startDate !== undefined) {
    // El día del mes sale de la fecha de inicio; en diario y semanal no aplica.
    patch.byMonthDay =
      form.frequency === "MONTHLY" || form.frequency === "YEARLY"
        ? Number(form.startDate.slice(8, 10))
        : null;
  }
  if (form.maxOccurrences !== rule.maxOccurrences) {
    patch.maxOccurrences = form.maxOccurrences;
  }
  if (form.autoPost !== rule.autoPost) patch.autoPost = form.autoPost;

  return patch;
};

/**
 * Alta y edición de un programado, en la misma hoja.
 *
 * Al editar, el tipo y la moneda quedan fijos: cambiarlos redefiniría lo que
 * significan el importe y las ocurrencias ya generadas. Lo demás se puede
 * tocar; si cambia el patrón (frecuencia o fecha de inicio), la serie se
 * reancla hacia adelante sin tocar lo ya materializado.
 */
function RuleSheet({
  open,
  onOpenChange,
  spaceId,
  rule,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  spaceId: string;
  rule?: RecurringRuleDTO;
}) {
  const queryClient = useQueryClient();
  const session = useSession();
  const { space } = useActiveSpace();
  const timezone = session.data?.timezone ?? "Europe/Madrid";
  const primaryCurrency = space?.primaryCurrency ?? "EUR";
  const isEdit = rule !== undefined;

  const [type, setType] = useState<"EXPENSE" | "INCOME">(
    rule?.type ?? "EXPENSE",
  );
  const [amount, setAmount] = useState(
    rule === undefined
      ? ""
      : toDecimalString(
          money(BigInt(rule.amount.amountMinor), rule.amount.currency),
        ),
  );
  const [description, setDescription] = useState(rule?.description ?? "");
  /**
   * `undefined` = sin elegir (manda la principal, como al cargar un movimiento
   * suelto); `null` = la cuenta se elige al aceptar cada ocurrencia.
   */
  const [accountChoice, setAccountChoice] = useState<string | null | undefined>(
    rule === undefined ? undefined : (rule.account?.id ?? null),
  );
  const [categoryId, setCategoryId] = useState<string | null>(
    rule?.category?.id ?? null,
  );
  const [frequency, setFrequency] = useState<Frequency>(
    rule?.frequency ?? "MONTHLY",
  );
  const [startDate, setStartDate] = useState(rule?.startDate ?? "");
  const [autoPost, setAutoPost] = useState(rule?.autoPost ?? true);
  // Las que FALTAN, no las del acuerdo: es lo que se pregunta y lo que se edita.
  const [times, setTimes] = useState<string | null>(
    rule?.maxOccurrences == null
      ? null
      : String(Math.max(0, rule.maxOccurrences - rule.occurrencesCreated)),
  );

  const accounts = useAccounts(spaceId);
  const categories = useCategories(spaceId, type);

  const active = (accounts.data ?? []).filter(
    (a) =>
      !a.isArchived &&
      // Al editar, la moneda ya está fijada: solo cuentas en esa moneda.
      (rule === undefined || a.currency === rule.amount.currency),
  );
  const account =
    accountChoice === null
      ? null
      : (active.find((a) => a.id === accountChoice) ??
        active.find((a) => a.isDefault) ??
        active[0] ??
        null);
  const noAccount = accountChoice === null;

  const currency =
    rule?.amount.currency ?? account?.currency ?? primaryCurrency;
  const exponent = getCurrencyExponent(currency);
  const effectiveStart = startDate === "" ? todayIn(timezone) : startDate;
  // Sin cuenta no hay dónde asentar el movimiento: no puede darse por hecho.
  const effectiveAutoPost = noAccount ? false : autoPost;

  // La categoría elegida puede ser una subcategoría: su raíz es la que se
  // marca arriba, y abajo se despliegan las hermanas.
  const roots = categories.data ?? [];
  const selectedRoot = roots.find(
    (root) =>
      root.id === categoryId ||
      root.children.some((child) => child.id === categoryId),
  );

  const save = useMutation({
    mutationFn: async (): Promise<"created" | "updated" | "unchanged"> => {
      const amountMinor = toMinor(amount, exponent);
      const trimmed = description.trim();
      const maxOccurrences =
        times === null || times === ""
          ? null
          : (rule?.occurrencesCreated ?? 0) + Number(times);

      if (rule === undefined) {
        await api.post(`/spaces/${spaceId}/recurring`, {
          accountId: account?.id ?? null,
          categoryId,
          type,
          amountMinor,
          // Sin cuenta de la que tomarla, la moneda va explícita.
          ...(noAccount ? { currency } : {}),
          frequency,
          interval: 1,
          startDate: effectiveStart,
          autoPost: effectiveAutoPost,
          isActive: true,
          ...(trimmed !== "" ? { description: trimmed } : {}),
          // `null` = indefinido, que es lo que la columna ya significaba.
          ...(maxOccurrences !== null ? { maxOccurrences } : {}),
          // El día del mes sale de la fecha de inicio: pedirlo aparte sería
          // pedir dos veces lo mismo y dejar que se contradigan.
          ...(frequency === "MONTHLY" || frequency === "YEARLY"
            ? { byMonthDay: Number(effectiveStart.slice(8, 10)) }
            : {}),
        });
        return "created";
      }

      const patch = buildPatch(rule, {
        amountMinor,
        description: trimmed === "" ? null : trimmed,
        categoryId,
        accountId: account?.id ?? null,
        frequency,
        startDate: effectiveStart,
        maxOccurrences,
        autoPost: effectiveAutoPost,
      });
      if (Object.keys(patch).length === 0) return "unchanged";

      await api.patch(`/spaces/${spaceId}/recurring/${rule.id}`, patch);
      return "updated";
    },
    onSuccess: async (result) => {
      toast.success(
        result === "created"
          ? "Movimiento programado"
          : result === "updated"
            ? "Programado actualizado"
            : "No había nada que cambiar",
      );
      if (!isEdit) {
        setAmount("");
        setDescription("");
        setCategoryId(null);
        setTimes(null);
      }
      onOpenChange(false);
      await queryClient.invalidateQueries({ queryKey: spaceScopeKey(spaceId) });
    },
    onError: (error: unknown) => {
      toast.error(
        error instanceof ApiError
          ? error.message
          : isEdit
            ? "No se pudo guardar"
            : "No se pudo programar",
      );
    },
  });

  const canSave =
    (account !== null || noAccount) &&
    /^\d+([.,]\d+)?$/.test(amount) &&
    Number(amount.replace(",", ".")) > 0 &&
    // Con "un número de veces" elegido pero vacío no se guarda: sería un
    // límite que nadie puso.
    (times === null || (times !== "" && Number(times) > 0)) &&
    !save.isPending;

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[90dvh] pb-safe-bottom">
        <DrawerHeader className="text-left">
          <DrawerTitle>
            {isEdit ? "Editar programado" : "Nuevo programado"}
          </DrawerTitle>
        </DrawerHeader>

        <DrawerBody className="space-y-4">
          {/* El tipo no se edita: cambiarlo redefiniría las ocurrencias ya
              generadas y las categorías elegidas. */}
          {!isEdit && (
            <div className="flex rounded-full bg-secondary p-1">
              {(["EXPENSE", "INCOME"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => {
                    if (option !== type) setCategoryId(null);
                    setType(option);
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
          )}

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
            <Label htmlFor="rule-start">
              {isEdit ? "Fecha de referencia" : "Primera vez"}
            </Label>
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
              {isEdit
                ? "Cambiarla, o la frecuencia, mueve las próximas fechas. Lo ya generado no se toca."
                : "Si ponés una fecha pasada, se generan también las que ya vencieron, cada una con su fecha."}
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
                const isActive = (times === null) === (option.value === null);

                return (
                  <button
                    key={option.label}
                    type="button"
                    onClick={() => {
                      setTimes(option.value);
                    }}
                    aria-pressed={isActive}
                    className={cn(
                      "min-h-touch rounded-full border px-3 text-sm",
                      isActive &&
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
                    setAccountChoice(option.id);
                  }}
                  aria-pressed={!noAccount && option.id === account?.id}
                  className={cn(
                    "min-h-touch shrink-0 rounded-xl border px-3 py-2 text-sm",
                    !noAccount &&
                      option.id === account?.id &&
                      "ring-2 ring-primary",
                  )}
                >
                  {option.name}
                </button>
              ))}
              {/**
               * Para lo que se paga desde donde haya plata ese mes. La regla
               * avisa que venció y en ese momento se dice de qué cuenta salió.
               */}
              <button
                type="button"
                onClick={() => {
                  setAccountChoice(null);
                }}
                aria-pressed={noAccount}
                className={cn(
                  "min-h-touch shrink-0 rounded-xl border border-dashed px-3 py-2 text-sm",
                  noAccount && "ring-2 ring-primary",
                )}
              >
                Elegir al aceptar
              </button>
            </div>
            {noAccount && (
              <p className="text-xs text-muted-foreground">
                Cuando venza va a aparecer en el inicio para que elijas de qué
                cuenta salió. Hasta entonces no se registra nada.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label>Categoría</Label>
            <div className="flex flex-wrap gap-2">
              {roots.map((root) => (
                <button
                  key={root.id}
                  type="button"
                  onClick={() => {
                    // Tocar la raíz elegida la deselecciona, incluida la
                    // subcategoría que tuviera.
                    setCategoryId(
                      selectedRoot?.id === root.id ? null : root.id,
                    );
                  }}
                  aria-pressed={selectedRoot?.id === root.id}
                  className={cn(
                    "min-h-touch rounded-full border px-3 text-sm",
                    selectedRoot?.id === root.id &&
                      "border-primary bg-primary text-primary-foreground",
                  )}
                >
                  {root.name}
                </button>
              ))}
            </div>

            {selectedRoot !== undefined && selectedRoot.children.length > 0 && (
              <SubcategoryChips
                root={selectedRoot}
                selectedId={categoryId}
                onSelect={setCategoryId}
              />
            )}
          </div>

          <div
            className={cn(
              "flex items-start justify-between gap-4 rounded-lg border p-3",
              noAccount && "opacity-60",
            )}
          >
            <div className="min-w-0">
              <Label htmlFor="rule-autopost">Dar por hecho</Label>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {noAccount
                  ? "Sin cuenta no puede darse por hecho: se confirma al elegirla."
                  : "Activado, el movimiento nace confirmado. Desactivado, queda pendiente para que lo revises."}
              </p>
            </div>
            <Switch
              id="rule-autopost"
              checked={effectiveAutoPost}
              disabled={noAccount}
              onCheckedChange={setAutoPost}
            />
          </div>

          <Button
            className="min-h-touch w-full"
            disabled={!canSave}
            onClick={() => {
              save.mutate();
            }}
          >
            {save.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : isEdit ? (
              "Guardar cambios"
            ) : (
              "Programar"
            )}
          </Button>
        </DrawerBody>
      </DrawerContent>
    </Drawer>
  );
}

/**
 * Las subcategorías de la raíz elegida. "General" es la raíz misma: no todo
 * gasto de "Transporte" es de una subcategoría concreta.
 */
function SubcategoryChips({
  root,
  selectedId,
  onSelect,
}: {
  root: CategoryTreeNode;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const options = [
    { id: root.id, name: "General" },
    ...root.children.map((child) => ({ id: child.id, name: child.name })),
  ];

  return (
    <div className="space-y-1.5 pl-3">
      <span className="text-xs text-muted-foreground">
        Subcategoría de {root.name}
      </span>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => {
              onSelect(option.id);
            }}
            aria-pressed={selectedId === option.id}
            className={cn(
              "min-h-touch rounded-full border px-3 text-xs",
              selectedId === option.id && "border-primary bg-primary/10",
            )}
          >
            {option.name}
          </button>
        ))}
      </div>
    </div>
  );
}
