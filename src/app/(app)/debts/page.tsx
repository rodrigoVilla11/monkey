"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { HandCoins, Loader2, Plus, Trash2 } from "lucide-react";
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
import { Switch } from "@/components/ui/switch";
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
import {
  DEBT_DIRECTIONS,
  DEBT_DIRECTION_LABELS,
  type DebtDTO,
  type NetPositionDTO,
} from "@/shared/contracts/debts";
import type { RECURRENCE_FREQUENCIES } from "@/shared/contracts/recurring";
import { SUGGESTED_CURRENCIES, getCurrencyExponent } from "@/shared/currency";
import { formatCalendarDate, todayIn } from "@/shared/dates";
import { hasAtLeast } from "@/shared/roles";

const STATUS_LABEL: Record<DebtDTO["status"], string> = {
  SETTLED: "Saldada",
  ON_TRACK: "En tiempo",
  BEHIND: "Atrasada",
  OVERDUE: "Vencida",
};

/**
 * Las cuatro periodicidades que se ofrecen, en el vocabulario de la calle.
 *
 * "Quincenal" no existe como frecuencia: es semanal cada dos. Se traduce acá y
 * no en la base para que el motor de recurrencia siga siendo uno solo.
 */
const CADENCES = [
  { label: "Semanal", frequency: "WEEKLY", interval: 1 },
  { label: "Quincenal", frequency: "WEEKLY", interval: 2 },
  { label: "Mensual", frequency: "MONTHLY", interval: 1 },
  { label: "Anual", frequency: "YEARLY", interval: 1 },
] as const;

interface PlanDraft {
  readonly amount: string;
  readonly frequency: (typeof RECURRENCE_FREQUENCIES)[number];
  readonly interval: number;
  readonly startDate: string;
}

const planIsValid = (draft: PlanDraft | null): boolean =>
  draft === null ||
  (isAmountInput(draft.amount) &&
    Number(draft.amount.replace(",", ".")) > 0 &&
    draft.startDate !== "");

/** El plan para la API, o `null` para sacarlo. */
const planPayload = (
  draft: PlanDraft | null,
  currency: string,
): {
  amountMinor: string;
  frequency: PlanDraft["frequency"];
  interval: number;
  startDate: string;
} | null =>
  draft === null
    ? null
    : {
        amountMinor: toMinor(draft.amount, getCurrencyExponent(currency)),
        frequency: draft.frequency,
        interval: draft.interval,
        startDate: draft.startDate,
      };

/**
 * El acuerdo: cuánto y cada cuánto.
 *
 * El interruptor es lo que distingue "sin plan" de "un plan a medio escribir":
 * apagado manda `null` y la deuda vuelve a no tener nada pactado.
 */
function PlanFields({
  value,
  onChange,
  currency,
  today,
  idPrefix,
}: {
  value: PlanDraft | null;
  onChange: (value: PlanDraft | null) => void;
  currency: string;
  today: string;
  idPrefix: string;
}) {
  return (
    <div className="space-y-3 rounded-xl border p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <Label htmlFor={`${idPrefix}-plan`}>Plan de pago/cobro</Label>
          <p className="text-xs text-muted-foreground">
            Lo que acordaron, para saber si se está cumpliendo.
          </p>
        </div>
        <Switch
          id={`${idPrefix}-plan`}
          checked={value !== null}
          onCheckedChange={(checked) => {
            onChange(
              checked
                ? {
                    amount: "",
                    frequency: "MONTHLY",
                    interval: 1,
                    startDate: today,
                  }
                : null,
            );
          }}
        />
      </div>

      {value !== null && (
        <>
          <div className="space-y-1.5">
            <Label htmlFor={`${idPrefix}-plan-amount`}>
              Cuánto, cada vez ({currency})
            </Label>
            <Input
              id={`${idPrefix}-plan-amount`}
              value={value.amount}
              onChange={(e) => {
                onChange({ ...value, amount: e.target.value });
              }}
              placeholder="300"
              inputMode="decimal"
              className="min-h-touch"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Cada cuánto</Label>
            <div className="flex flex-wrap gap-2">
              {CADENCES.map((cadence) => {
                const active =
                  value.frequency === cadence.frequency &&
                  value.interval === cadence.interval;

                return (
                  <button
                    key={cadence.label}
                    type="button"
                    onClick={() => {
                      onChange({
                        ...value,
                        frequency: cadence.frequency,
                        interval: cadence.interval,
                      });
                    }}
                    aria-pressed={active}
                    className={cn(
                      "min-h-touch rounded-full border px-3 text-sm",
                      active &&
                        "border-primary bg-primary text-primary-foreground",
                    )}
                  >
                    {cadence.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={`${idPrefix}-plan-start`}>Desde</Label>
            <Input
              id={`${idPrefix}-plan-start`}
              type="date"
              value={value.startDate}
              onChange={(e) => {
                onChange({ ...value, startDate: e.target.value });
              }}
              className="min-h-touch"
            />
            <p className="text-xs text-muted-foreground">
              El día marca el resto: mensual desde un 31 cae el 31 de cada mes,
              y el último día en los meses que no lo tienen. Los cobros los
              seguís cargando vos — monKey no cobra ni genera movimientos.
            </p>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Deudas y préstamos.
 *
 * Arriba, la posición neta: caja más lo que te deben menos lo que debés. Está
 * acá y no en el dashboard a propósito — es la única pantalla donde las tres
 * cifras se ven juntas y se entiende de dónde sale cada una.
 */
export default function DebtsPage() {
  const session = useSession();
  const { space } = useActiveSpace();
  const spaceId = space?.id ?? "";
  const [showNew, setShowNew] = useState(false);
  const [showSettled, setShowSettled] = useState(false);
  const [editing, setEditing] = useState<DebtDTO | null>(null);

  const debts = useQuery({
    queryKey: [...spaceScopeKey(spaceId), "debts", showSettled],
    queryFn: () =>
      api.get<{ debts: DebtDTO[] }>(
        `/spaces/${spaceId}/debts${showSettled ? "?includeSettled=true" : ""}`,
      ),
    select: (data) => data.debts,
    enabled: spaceId !== "",
  });

  const position = useQuery({
    queryKey: [...spaceScopeKey(spaceId), "net-position"],
    queryFn: () =>
      api.get<{ position: NetPositionDTO }>(`/spaces/${spaceId}/net-position`),
    select: (data) => data.position,
    enabled: spaceId !== "",
  });

  const locale = session.data?.locale ?? "es-ES";
  const canEdit = space !== undefined && hasAtLeast(space.role, "MEMBER");

  // Preselecciona la preferida de la persona (Ajustes); la del Space sigue
  // siendo contra la que se convierte la posición neta.
  const primaryCurrency = space?.primaryCurrency ?? "EUR";
  const defaultCurrency = session.data?.preferredCurrency ?? primaryCurrency;

  return (
    <div className="space-y-4 py-3">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Deudas</h1>
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

      {position.data !== undefined && (
        <Card className="gap-2 p-4">
          <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Posición neta
          </span>
          <span className="text-2xl font-semibold tabular-nums">
            {formatMoneyDTO(position.data.net, locale)}
          </span>
          {/* Se dice de dónde sale: un total sin desglose invita a desconfiar. */}
          <span className="text-xs text-muted-foreground tabular-nums">
            {formatMoneyDTO(position.data.accounts, locale)} en cuentas
            {position.data.receivable.amountMinor !== "0" && (
              <>
                {" "}
                · +{formatMoneyDTO(position.data.receivable, locale)} por cobrar
              </>
            )}
            {position.data.payable.amountMinor !== "0" && (
              <> · −{formatMoneyDTO(position.data.payable, locale)} por pagar</>
            )}
          </span>
          {/**
           * Con qué se convirtió y de cuándo. La fecha no es un detalle: una
           * cotización de hace tres meses convierte igual de bien y el número
           * significa otra cosa, así que el total no puede presentarse como un
           * hecho sin decir sobre qué se apoya.
           */}
          {position.data.conversions.length > 0 && (
            <span className="text-xs text-muted-foreground">
              Incluye{" "}
              {position.data.conversions.map((conversion, index) => (
                <span key={conversion.currency}>
                  {index > 0 && " y "}
                  {conversion.currency} a{" "}
                  {formatCalendarDate(conversion.date, locale, {
                    dateStyle: "medium",
                  })}
                </span>
              ))}
              . Es la última cotización que cargaste, no la del día.
            </span>
          )}

          {position.data.missingRates.length > 0 && (
            <span className="text-xs text-muted-foreground">
              {position.data.excludedCount === 1
                ? "1 posición quedó fuera"
                : `${String(position.data.excludedCount)} posiciones quedaron fuera`}{" "}
              del total: falta la cotización de{" "}
              {position.data.missingRates.join(", ")}. Cargala en Ajustes →
              Cotizaciones y entra sola.
            </span>
          )}
        </Card>
      )}

      <button
        type="button"
        onClick={() => {
          setShowSettled(!showSettled);
        }}
        aria-pressed={showSettled}
        className="min-h-touch text-xs text-muted-foreground"
      >
        {showSettled ? "Ver solo las abiertas" : "Ver también las saldadas"}
      </button>

      {debts.data === undefined ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }, (_unused, i) => (
            <Skeleton key={i} className="h-32 w-full rounded-xl" />
          ))}
        </div>
      ) : debts.data.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-16 text-center text-muted-foreground">
          <HandCoins className="size-10 opacity-40" />
          <p className="text-sm">No hay deudas anotadas</p>
          <p className="max-w-xs text-xs">
            Lo que debés y lo que te deben. monKey lleva la cuenta de lo pagado;
            no calcula cuotas ni intereses por vos.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {debts.data.map((debt) => (
            <DebtCard
              key={debt.id}
              debt={debt}
              spaceId={spaceId}
              locale={locale}
              canEdit={canEdit}
              onEdit={() => {
                setEditing(debt);
              }}
            />
          ))}
        </div>
      )}

      <NewDebtSheet
        // La moneda preseleccionada vive en un useState del sheet. Si la sesión
        // termina de cargar después del primer render, el `key` lo remonta con
        // el valor bueno — el drawer todavía está cerrado, no se nota.
        key={defaultCurrency}
        open={showNew}
        onOpenChange={setShowNew}
        spaceId={spaceId}
        defaultCurrency={defaultCurrency}
        primaryCurrency={primaryCurrency}
      />

      {/**
       * Con `key` por deuda: sin eso, abrir una segunda ficha reusaría el
       * estado del formulario de la primera y editarías la deuda de Juan con
       * los datos de la de Ana.
       */}
      {editing !== null && (
        <EditDebtSheet
          key={editing.id}
          open
          onOpenChange={(value) => {
            if (!value) setEditing(null);
          }}
          spaceId={spaceId}
          debt={editing}
        />
      )}
    </div>
  );
}

function DebtCard({
  debt,
  spaceId,
  locale,
  canEdit,
  onEdit,
}: {
  debt: DebtDTO;
  spaceId: string;
  locale: string;
  canEdit: boolean;
  onEdit: () => void;
}) {
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState("");

  const owed = debt.direction === "OWED_BY_ME";

  const invalidate = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: spaceScopeKey(spaceId) });
  };

  const pay = useMutation({
    mutationFn: () =>
      api.post(`/spaces/${spaceId}/debts/${debt.id}/payments`, {
        amountMinor: toMinor(
          amount,
          getCurrencyExponent(debt.original.currency),
        ),
      }),
    onSuccess: async () => {
      toast.success(owed ? "Pago registrado" : "Cobro registrado");
      setAmount("");
      await invalidate();
    },
    onError: (error: unknown) => {
      toast.error(
        error instanceof ApiError ? error.message : "No se pudo registrar",
      );
    },
  });

  const canPay = /^\d+([.,]\d+)?$/.test(amount) && !pay.isPending;

  /**
   * Sin vencimiento no hay contra qué estar en tiempo: el motor devuelve
   * ON_TRACK porque no puede estar atrasada, pero mostrar "En tiempo" en verde
   * insinúa un plazo que nadie pactó. Se dice lo único cierto — que no tiene
   * fecha — y en gris, que es lo que es: un dato, no una buena noticia.
   */
  const undated = !debt.settled && debt.dueDate === null;

  const summary = (
    <>
      <div className="flex items-baseline justify-between gap-2">
        <span className="min-w-0 truncate text-sm font-semibold">
          <span className={owed ? "text-expense" : "text-income"}>
            {DEBT_DIRECTION_LABELS[debt.direction]}
          </span>{" "}
          {debt.counterparty}
        </span>
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
          {debt.percentage.toFixed(0)}%
        </span>
      </div>

      <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
        <div
          className={cn(
            "h-full rounded-full",
            owed ? "bg-expense" : "bg-income",
          )}
          style={{ width: `${String(debt.percentage)}%` }}
        />
      </div>

      <div className="flex items-baseline justify-between text-sm tabular-nums">
        <span className="font-medium">
          {formatMoneyDTO(debt.remaining, locale)}{" "}
          <span className="text-xs font-normal text-muted-foreground">
            {owed ? "pendiente" : "por cobrar"}
          </span>
        </span>
        <span className="text-xs text-muted-foreground">
          de {formatMoneyDTO(debt.original, locale)}
        </span>
      </div>
    </>
  );

  return (
    <Card className={cn("gap-3 p-4", debt.settled && "opacity-60")}>
      {canEdit ? (
        // Todo el resumen abre el panel de edición: un lápiz de 16px al costado
        // es un blanco imposible en un teléfono. El campo de cobrar queda
        // afuera del botón porque es lo que se usa todos los días.
        <button
          type="button"
          onClick={onEdit}
          className="w-full space-y-3 text-left"
          aria-label={`Editar la deuda con ${debt.counterparty}`}
        >
          {summary}
        </button>
      ) : (
        <div className="space-y-3">{summary}</div>
      )}

      <p className="text-xs text-muted-foreground">
        <span
          className={cn(
            "font-medium",
            undated
              ? "text-muted-foreground"
              : debt.status === "BEHIND" || debt.status === "OVERDUE"
                ? "text-expense"
                : "text-income",
          )}
        >
          {undated ? "Sin vencimiento" : STATUS_LABEL[debt.status]}
        </span>
        {debt.dueDate !== null && (
          <>
            {" · vence el "}
            {formatCalendarDate(debt.dueDate, locale, { dateStyle: "medium" })}
          </>
        )}
        {debt.installments !== null && (
          <>
            {" · cuota "}
            {debt.installments.paid}/{debt.installments.total}
          </>
        )}
        {debt.requiredPerMonth !== null && (
          <>
            {" "}
            · {formatMoneyDTO(debt.requiredPerMonth, locale)}/mes para llegar
          </>
        )}
      </p>

      {/* El interés se muestra como COSTO del saldo, nunca como cuota. */}
      {debt.monthlyInterestCost !== null && debt.interestRateBps !== null && (
        <p className="text-xs text-muted-foreground">
          A {(debt.interestRateBps / 100).toFixed(2)} % anual, lo pendiente
          genera unos {formatMoneyDTO(debt.monthlyInterestCost, locale)} por
          mes. No es la cuota de tu préstamo.
        </p>
      )}

      {debt.plan !== null && !debt.settled && (
        <div className="space-y-1 rounded-lg bg-secondary/60 p-2.5">
          <p className="text-xs">
            <span className="font-medium">
              {formatMoneyDTO(debt.plan.amount, locale)}
            </span>{" "}
            <span className="text-muted-foreground lowercase">
              {debt.plan.description}
            </span>
          </p>

          {/**
           * Lo que uno viene a mirar: cuánto falta, en cuotas. Sale del saldo y
           * no de contar pagos — quien adelantó tres cuotas de una vez ve tres
           * menos, no una.
           */}
          <p className="text-xs">
            {owed ? "Te quedan pagar " : "Te quedan cobrar "}
            <span className="font-medium">
              {debt.plan.remainingInstallments}{" "}
              {debt.plan.remainingInstallments === 1 ? "cuota" : "cuotas"}
            </span>{" "}
            de {formatMoneyDTO(debt.plan.amount, locale)}
          </p>

          {/* El atraso es contra lo que YA venció, no contra el total. */}
          {debt.plan.behind.amountMinor !== "0" ? (
            <p className="text-xs text-expense">
              Atrasada: falta{owed ? "s" : ""} pagar{" "}
              {formatMoneyDTO(debt.plan.behind, locale)} de lo acordado hasta
              hoy.
            </p>
          ) : (
            debt.plan.dueCount > 0 && (
              <p className="text-xs text-income">
                Al día con lo acordado hasta hoy.
              </p>
            )
          )}

          <p className="text-xs text-muted-foreground">
            {debt.plan.nextDate !== null && (
              <>
                {owed ? "Próximo pago" : "Próximo cobro"} el{" "}
                {formatCalendarDate(debt.plan.nextDate, locale, {
                  dateStyle: "medium",
                })}
              </>
            )}
            {debt.plan.nextDate !== null && debt.plan.payoffDate !== null && (
              <> · </>
            )}
            {debt.plan.payoffDate !== null && (
              <>
                si se cumple, saldada el{" "}
                {formatCalendarDate(debt.plan.payoffDate, locale, {
                  dateStyle: "medium",
                })}
              </>
            )}
          </p>

          {/* Un acuerdo que no cierra hay que decirlo ahora, no en la última
              cuota. */}
          {!debt.plan.coversDebt && (
            <p className="text-xs text-expense">
              Con ese importe y esas cuotas el plan no llega a cubrir la deuda.
            </p>
          )}
        </div>
      )}

      {canEdit && !debt.settled && (
        <div className="flex items-center gap-2 border-t pt-3">
          <Input
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value);
            }}
            placeholder={`${owed ? "Pagar" : "Cobrar"} (${debt.original.currency})`}
            inputMode="decimal"
            aria-label={
              owed
                ? `Registrar pago a ${debt.counterparty}`
                : `Registrar cobro de ${debt.counterparty}`
            }
            className="min-h-touch flex-1"
          />
          <Button
            size="sm"
            className="min-h-touch"
            disabled={!canPay}
            onClick={() => {
              pay.mutate();
            }}
          >
            {pay.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : owed ? (
              "Pagué"
            ) : (
              "Cobré"
            )}
          </Button>
        </div>
      )}
    </Card>
  );
}

function NewDebtSheet({
  open,
  onOpenChange,
  spaceId,
  defaultCurrency,
  primaryCurrency,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  spaceId: string;
  /** La que arranca elegida: la preferida de la persona. */
  defaultCurrency: string;
  /** La de consolidación del Space: contra esta se convierte la posición neta. */
  primaryCurrency: string;
}) {
  const queryClient = useQueryClient();
  const session = useSession();
  const timezone = session.data?.timezone ?? "Europe/Madrid";
  const accounts = useAccounts(spaceId);

  const [direction, setDirection] =
    useState<(typeof DEBT_DIRECTIONS)[number]>("OWED_BY_ME");
  const [counterparty, setCounterparty] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState(defaultCurrency);
  const [rate, setRate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [installments, setInstallments] = useState("");
  const [plan, setPlan] = useState<PlanDraft | null>(null);
  const [moveMoney, setMoveMoney] = useState(false);
  const [accountId, setAccountId] = useState<string | null>(null);

  /**
   * El movimiento vive en la moneda de su cuenta, así que solo se ofrecen las
   * que coinciden con la de la deuda. La elegida se valida contra esta lista
   * al guardar: cambiar la moneda con una cuenta ya marcada no manda una que
   * no corresponde.
   */
  const eligibleAccounts = (accounts.data ?? []).filter(
    (account) => !account.isArchived && account.currency === currency,
  );
  const selectedAccountOk =
    accountId !== null &&
    eligibleAccounts.some((account) => account.id === accountId);

  /** La preferida primero, igual que al crear una cuenta. */
  const currencyOptions = [
    ...new Set([defaultCurrency, primaryCurrency, ...SUGGESTED_CURRENCIES]),
  ];

  const create = useMutation({
    mutationFn: () =>
      api.post(`/spaces/${spaceId}/debts`, {
        direction,
        counterparty,
        currency,
        originalAmountMinor: toMinor(amount, getCurrencyExponent(currency)),
        startDate: todayIn(timezone),
        // La tasa se guarda en basis points: 12,5 % → 1250. Se convierte con
        // enteros para no meter un float en el camino.
        ...(rate !== "" ? { interestRateBps: Number(toMinor(rate, 2)) } : {}),
        ...(dueDate !== "" ? { dueDate } : {}),
        ...(installments !== ""
          ? { installmentsTotal: Number(installments) }
          : {}),
        plan: planPayload(plan, currency),
        ...(moveMoney && selectedAccountOk
          ? { accountId, createMovement: true }
          : {}),
      }),
    onSuccess: async () => {
      toast.success(
        moveMoney && selectedAccountOk
          ? "Deuda anotada y movimiento creado"
          : "Deuda anotada",
      );
      setCounterparty("");
      setAmount("");
      setCurrency(defaultCurrency);
      setRate("");
      setDueDate("");
      setInstallments("");
      setPlan(null);
      setMoveMoney(false);
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
    counterparty.trim() !== "" &&
    /^\d+([.,]\d+)?$/.test(amount) &&
    Number(amount.replace(",", ".")) > 0 &&
    planIsValid(plan) &&
    (!moveMoney || selectedAccountOk) &&
    !create.isPending;

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[90dvh] pb-safe-bottom">
        <DrawerHeader className="text-left">
          <DrawerTitle>Nueva deuda</DrawerTitle>
        </DrawerHeader>

        <DrawerBody className="space-y-4">
          <div className="flex rounded-full bg-secondary p-1">
            {DEBT_DIRECTIONS.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => {
                  setDirection(option);
                }}
                className={cn(
                  "min-h-touch flex-1 rounded-full text-sm font-medium",
                  direction === option
                    ? option === "OWED_BY_ME"
                      ? "bg-expense text-expense-foreground"
                      : "bg-income text-income-foreground"
                    : "text-muted-foreground",
                )}
              >
                {DEBT_DIRECTION_LABELS[option]}
              </button>
            ))}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="debt-counterparty">
              {direction === "OWED_BY_ME" ? "¿A quién?" : "¿Quién?"}
            </Label>
            <Input
              id="debt-counterparty"
              value={counterparty}
              onChange={(e) => {
                setCounterparty(e.target.value);
              }}
              placeholder="Mi hermano"
              className="min-h-touch"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="debt-amount">Importe ({currency})</Label>
            <Input
              id="debt-amount"
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value);
              }}
              placeholder="5000"
              inputMode="decimal"
              className="min-h-touch"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Moneda</Label>
            <div className="flex flex-wrap gap-2">
              {currencyOptions.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => {
                    setCurrency(option);
                  }}
                  aria-pressed={currency === option}
                  className={cn(
                    "min-h-touch rounded-full border px-3 text-sm tabular-nums",
                    currency === option &&
                      "border-primary bg-primary text-primary-foreground",
                  )}
                >
                  {option}
                  {option === defaultCurrency && " ·"}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              {currency === primaryCurrency
                ? "Después no se puede cambiar: los pagos ya registrados quedarían en una moneda que la deuda ya no tiene."
                : `Los importes y los pagos van en ${currency}. En la posición neta se convierte a ${primaryCurrency} con la última cotización que tengas cargada — si falta, la deuda queda fuera del total y la pantalla lo dice en vez de inventarla. Después no se puede cambiar.`}
            </p>
          </div>

          {/**
           * El desembolso: la plata que salió (o entró) de verdad. Es opt-in
           * porque hay deudas que se anotan después de que la plata ya se
           * movió — crear siempre el movimiento la contaría dos veces.
           */}
          <div className="space-y-3 rounded-xl border p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <Label htmlFor="debt-move">
                  {direction === "OWED_TO_ME"
                    ? "Sacar la plata de una cuenta"
                    : "Ingresar la plata en una cuenta"}
                </Label>
                <p className="text-xs text-muted-foreground">
                  {direction === "OWED_TO_ME"
                    ? "Ajusta el saldo sin contar como gasto: es plata que vas a recuperar."
                    : "Ajusta el saldo sin contar como ingreso: es plata que vas a devolver."}
                </p>
              </div>
              <Switch
                id="debt-move"
                checked={moveMoney}
                onCheckedChange={setMoveMoney}
              />
            </div>

            {moveMoney &&
              (eligibleAccounts.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No tenés ninguna cuenta activa en {currency}. El movimiento
                  vive en la moneda de su cuenta: cambiá la moneda de la deuda o
                  creá una cuenta en {currency}.
                </p>
              ) : (
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {eligibleAccounts.map((account) => (
                    <button
                      key={account.id}
                      type="button"
                      onClick={() => {
                        setAccountId(account.id);
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
              ))}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="debt-rate">Interés anual % (opcional)</Label>
            <Input
              id="debt-rate"
              value={rate}
              onChange={(e) => {
                setRate(e.target.value);
              }}
              placeholder="12,5"
              inputMode="decimal"
              className="min-h-touch"
            />
            <p className="text-xs text-muted-foreground">
              Sirve para mostrarte cuánto cuesta por mes el saldo pendiente.
              monKey no calcula la cuota de tu préstamo: la que vale es la de tu
              banco.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="debt-due">Vencimiento (opcional)</Label>
            <Input
              id="debt-due"
              type="date"
              value={dueDate}
              onChange={(e) => {
                setDueDate(e.target.value);
              }}
              className="min-h-touch"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="debt-installments">
              Cuotas pactadas (opcional)
            </Label>
            <Input
              id="debt-installments"
              value={installments}
              onChange={(e) => {
                setInstallments(e.target.value.replace(/\D/g, ""));
              }}
              placeholder="12"
              inputMode="numeric"
              className="min-h-touch"
            />
            <p className="text-xs text-muted-foreground">
              Si además hay plan, lo topea: doce cuotas son doce fechas.
            </p>
          </div>

          <PlanFields
            value={plan}
            onChange={setPlan}
            currency={currency}
            today={todayIn(timezone)}
            idPrefix="new"
          />

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
              "Anotar deuda"
            )}
          </Button>
        </DrawerBody>
      </DrawerContent>
    </Drawer>
  );
}

/**
 * Editar una deuda.
 *
 * Se edita lo que el acuerdo puede cambiar de verdad: con quién es, cuánto, el
 * interés, el vencimiento, las cuotas y el plan. El sentido y la moneda no —dar
 * vuelta una deuda o cambiarle la moneda reinterpretaría todos los pagos ya
 * cargados—, y la pantalla lo dice en vez de no ofrecerlos y que parezca un
 * olvido.
 *
 * Los pagos registrados NO se tocan desde acá: bajar el importe original de una
 * deuda ya cobrada la deja saldada, que es lo que el servidor recalcula solo.
 */
function EditDebtSheet({
  open,
  onOpenChange,
  spaceId,
  debt,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  spaceId: string;
  debt: DebtDTO;
}) {
  const queryClient = useQueryClient();
  const session = useSession();
  const timezone = session.data?.timezone ?? "Europe/Madrid";
  const exponent = getCurrencyExponent(debt.original.currency);

  const [counterparty, setCounterparty] = useState(debt.counterparty);
  const [amount, setAmount] = useState(
    minorToInput(debt.original.amountMinor, exponent),
  );
  const [rate, setRate] = useState(
    // La tasa vive en basis points: 1250 → "12.50", el inverso exacto de lo
    // que hace el guardado.
    debt.interestRateBps === null
      ? ""
      : minorToInput(String(debt.interestRateBps), 2),
  );
  const [dueDate, setDueDate] = useState(debt.dueDate ?? "");
  const [installments, setInstallments] = useState(
    debt.installments === null ? "" : String(debt.installments.total),
  );
  const [plan, setPlan] = useState<PlanDraft | null>(
    debt.plan === null
      ? null
      : {
          amount: minorToInput(debt.plan.amount.amountMinor, exponent),
          frequency: debt.plan.frequency,
          interval: debt.plan.interval,
          startDate: debt.plan.startDate,
        },
  );

  const invalidate = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: spaceScopeKey(spaceId) });
  };

  const save = useMutation({
    mutationFn: () =>
      api.patch(`/spaces/${spaceId}/debts/${debt.id}`, {
        counterparty,
        originalAmountMinor: toMinor(amount, exponent),
        // `null` explícito y no omitido: así se puede SACAR un interés o un
        // vencimiento que ya no aplica, que es la mitad de para qué sirve
        // editar.
        interestRateBps: rate === "" ? null : Number(toMinor(rate, 2)),
        dueDate: dueDate === "" ? null : dueDate,
        installmentsTotal: installments === "" ? null : Number(installments),
        plan: planPayload(plan, debt.original.currency),
      }),
    onSuccess: async () => {
      toast.success("Deuda actualizada");
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
    mutationFn: () => api.delete(`/spaces/${spaceId}/debts/${debt.id}`),
    onSuccess: async () => {
      toast.success("Deuda eliminada");
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
    counterparty.trim() !== "" &&
    isAmountInput(amount) &&
    Number(amount.replace(",", ".")) > 0 &&
    (rate === "" || isAmountInput(rate)) &&
    planIsValid(plan) &&
    !busy;

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[90dvh] pb-safe-bottom">
        <DrawerHeader className="text-left">
          <DrawerTitle>
            {DEBT_DIRECTION_LABELS[debt.direction]} · {debt.counterparty}
          </DrawerTitle>
        </DrawerHeader>

        <DrawerBody className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="edit-counterparty">
              {debt.direction === "OWED_BY_ME" ? "¿A quién?" : "¿Quién?"}
            </Label>
            <Input
              id="edit-counterparty"
              value={counterparty}
              onChange={(e) => {
                setCounterparty(e.target.value);
              }}
              className="min-h-touch"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="edit-amount">
              Importe ({debt.original.currency})
            </Label>
            <Input
              id="edit-amount"
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value);
              }}
              inputMode="decimal"
              className="min-h-touch"
            />
            <p className="text-xs text-muted-foreground">
              Es lo pactado, no lo que falta. Ya{" "}
              {debt.paymentCount === 1 ? "se registró" : "se registraron"}{" "}
              {debt.paymentCount} {debt.paymentCount === 1 ? "pago" : "pagos"}{" "}
              por {formatMoneyDTO(debt.paid, session.data?.locale ?? "es-ES")},
              que no se tocan: si bajás el importe por debajo de eso, la deuda
              queda saldada.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="edit-rate">Interés anual % (opcional)</Label>
            <Input
              id="edit-rate"
              value={rate}
              onChange={(e) => {
                setRate(e.target.value);
              }}
              placeholder="12,5"
              inputMode="decimal"
              className="min-h-touch"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="edit-due">Vencimiento (opcional)</Label>
            <Input
              id="edit-due"
              type="date"
              value={dueDate}
              onChange={(e) => {
                setDueDate(e.target.value);
              }}
              className="min-h-touch"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="edit-installments">
              Cuotas pactadas (opcional)
            </Label>
            <Input
              id="edit-installments"
              value={installments}
              onChange={(e) => {
                setInstallments(e.target.value.replace(/\D/g, ""));
              }}
              placeholder="12"
              inputMode="numeric"
              className="min-h-touch"
            />
          </div>

          <PlanFields
            value={plan}
            onChange={setPlan}
            currency={debt.original.currency}
            today={todayIn(timezone)}
            idPrefix="edit"
          />

          <p className="text-xs text-muted-foreground">
            El sentido y la moneda no se pueden cambiar: los {debt.paymentCount}{" "}
            pagos ya registrados están en {debt.original.currency} y dar vuelta
            la deuda los convertiría en su opuesto. Para eso, andá por una
            nueva.
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
            Eliminar la deuda y sus pagos
          </Button>
        </DrawerBody>
      </DrawerContent>
    </Drawer>
  );
}
