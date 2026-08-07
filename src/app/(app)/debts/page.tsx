"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { HandCoins, Loader2, Plus, Trash2 } from "lucide-react";
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
import { useActiveSpace, useSession } from "@/lib/hooks/use-session";
import { spaceScopeKey } from "@/lib/query-keys";
import { cn } from "@/lib/utils";
import {
  DEBT_DIRECTIONS,
  DEBT_DIRECTION_LABELS,
  type DebtDTO,
  type NetPositionDTO,
} from "@/shared/contracts/debts";
import { getCurrencyExponent } from "@/shared/currency";
import { formatCalendarDate, todayIn } from "@/shared/dates";
import { hasAtLeast } from "@/shared/roles";

const STATUS_LABEL: Record<DebtDTO["status"], string> = {
  SETTLED: "Saldada",
  ON_TRACK: "En tiempo",
  BEHIND: "Atrasada",
  OVERDUE: "Vencida",
};

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
          {position.data.excludedCount > 0 && (
            <span className="text-xs text-muted-foreground">
              {position.data.excludedCount} en otra moneda quedaron fuera del
              total: sumarlas necesitaría una cotización.
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
            Lo que debés y lo que te deben. Monkey lleva la cuenta de lo pagado;
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
            />
          ))}
        </div>
      )}

      <NewDebtSheet
        open={showNew}
        onOpenChange={setShowNew}
        spaceId={spaceId}
        currency={space?.primaryCurrency ?? "EUR"}
      />
    </div>
  );
}

function DebtCard({
  debt,
  spaceId,
  locale,
  canEdit,
}: {
  debt: DebtDTO;
  spaceId: string;
  locale: string;
  canEdit: boolean;
}) {
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState("");

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
      toast.success("Pago registrado");
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
    mutationFn: () => api.delete(`/spaces/${spaceId}/debts/${debt.id}`),
    onSuccess: async () => {
      toast.success("Deuda eliminada");
      await invalidate();
    },
  });

  const owed = debt.direction === "OWED_BY_ME";
  const canPay = /^\d+([.,]\d+)?$/.test(amount) && !pay.isPending;

  return (
    <Card className={cn("gap-3 p-4", debt.settled && "opacity-60")}>
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

      <p className="text-xs text-muted-foreground">
        <span
          className={cn(
            "font-medium",
            debt.status === "BEHIND" || debt.status === "OVERDUE"
              ? "text-expense"
              : "text-income",
          )}
        >
          {STATUS_LABEL[debt.status]}
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

      {canEdit && !debt.settled && (
        <div className="flex items-center gap-2 border-t pt-3">
          <Input
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value);
            }}
            placeholder={`Pagar (${debt.original.currency})`}
            inputMode="decimal"
            aria-label={`Registrar pago a ${debt.counterparty}`}
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
          <Button
            variant="ghost"
            size="icon"
            className="min-h-touch min-w-touch shrink-0 text-muted-foreground"
            aria-label={`Eliminar deuda con ${debt.counterparty}`}
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

function NewDebtSheet({
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
  const session = useSession();
  const timezone = session.data?.timezone ?? "Europe/Madrid";

  const [direction, setDirection] =
    useState<(typeof DEBT_DIRECTIONS)[number]>("OWED_BY_ME");
  const [counterparty, setCounterparty] = useState("");
  const [amount, setAmount] = useState("");
  const [rate, setRate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [installments, setInstallments] = useState("");

  const create = useMutation({
    mutationFn: () =>
      api.post(`/spaces/${spaceId}/debts`, {
        direction,
        counterparty,
        originalAmountMinor: toMinor(amount, getCurrencyExponent(currency)),
        startDate: todayIn(timezone),
        // La tasa se guarda en basis points: 12,5 % → 1250. Se convierte con
        // enteros para no meter un float en el camino.
        ...(rate !== "" ? { interestRateBps: Number(toMinor(rate, 2)) } : {}),
        ...(dueDate !== "" ? { dueDate } : {}),
        ...(installments !== ""
          ? { installmentsTotal: Number(installments) }
          : {}),
      }),
    onSuccess: async () => {
      toast.success("Deuda anotada");
      setCounterparty("");
      setAmount("");
      setRate("");
      setDueDate("");
      setInstallments("");
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
    !create.isPending;

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[90dvh] pb-safe-bottom">
        <DrawerHeader className="text-left">
          <DrawerTitle>Nueva deuda</DrawerTitle>
        </DrawerHeader>

        <div className="app-scroll space-y-4 px-4 pb-6">
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
              Monkey no calcula la cuota de tu préstamo: la que vale es la de tu
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
              "Anotar deuda"
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
