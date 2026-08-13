"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, PiggyBank, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { BudgetBar } from "@/components/budgets/budget-bar";
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
import { minorToInput, toMinor } from "@/lib/format";
import { useAccounts, useCategories } from "@/lib/hooks/use-domain";
import { useActiveSpace, useSession } from "@/lib/hooks/use-session";
import { spaceScopeKey } from "@/lib/query-keys";
import { cn } from "@/lib/utils";
import {
  BUDGET_PERIODS,
  BUDGET_PERIOD_LABELS,
  type BudgetPeriod,
  type BudgetWithStatus,
} from "@/shared/contracts/budgets";
import { getCurrencyExponent } from "@/shared/currency";
import { hasAtLeast } from "@/shared/roles";

export default function BudgetsPage() {
  const session = useSession();
  const { space } = useActiveSpace();
  const spaceId = space?.id ?? "";
  const [showNew, setShowNew] = useState(false);
  const [editing, setEditing] = useState<BudgetWithStatus | null>(null);

  const budgets = useQuery({
    queryKey: [...spaceScopeKey(spaceId), "budgets"],
    queryFn: () =>
      api.get<{ budgets: BudgetWithStatus[] }>(`/spaces/${spaceId}/budgets`),
    select: (data) => data.budgets,
    enabled: spaceId !== "",
  });

  const locale = session.data?.locale ?? "es-ES";
  const canEdit = space !== undefined && hasAtLeast(space.role, "MEMBER");

  return (
    <div className="space-y-4 py-3">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Presupuestos</h1>
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

      {budgets.data === undefined ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }, (_unused, i) => (
            <Skeleton key={i} className="h-32 w-full rounded-xl" />
          ))}
        </div>
      ) : budgets.data.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-16 text-center text-muted-foreground">
          <PiggyBank className="size-10 opacity-40" />
          <p className="text-sm">Todavía no hay presupuestos</p>
          <p className="max-w-xs text-xs">
            Poné un tope a una categoría o a unas cuentas y te avisamos cuando
            te estés acercando.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {budgets.data.map((budget) => (
            <Card key={budget.id} className="p-4">
              <BudgetBar
                budget={budget}
                locale={locale}
                onSelect={
                  canEdit
                    ? () => {
                        setEditing(budget);
                      }
                    : undefined
                }
              />
              {canEdit && <DeleteButton spaceId={spaceId} budget={budget} />}
            </Card>
          ))}
        </div>
      )}

      <BudgetSheet
        open={showNew}
        onOpenChange={setShowNew}
        spaceId={spaceId}
        currency={space?.primaryCurrency ?? "EUR"}
      />

      {/* Montado por presupuesto: el `key` reinicia el formulario al cambiar de
          uno a otro, sin tener que sincronizar cada campo a mano. */}
      {editing !== null && (
        <BudgetSheet
          key={editing.id}
          open
          onOpenChange={(value) => {
            if (!value) setEditing(null);
          }}
          spaceId={spaceId}
          currency={space?.primaryCurrency ?? "EUR"}
          budget={editing}
        />
      )}
    </div>
  );
}

function DeleteButton({
  spaceId,
  budget,
}: {
  spaceId: string;
  budget: BudgetWithStatus;
}) {
  const queryClient = useQueryClient();

  const remove = useMutation({
    mutationFn: () => api.delete(`/spaces/${spaceId}/budgets/${budget.id}`),
    onSuccess: async () => {
      toast.success("Presupuesto eliminado");
      await queryClient.invalidateQueries({ queryKey: spaceScopeKey(spaceId) });
    },
  });

  return (
    <button
      type="button"
      onClick={() => {
        remove.mutate();
      }}
      className="flex min-h-touch items-center gap-1.5 self-start border-t pt-3 text-xs text-muted-foreground"
    >
      <Trash2 className="size-3.5" />
      Eliminar
    </button>
  );
}

/**
 * Alta y edición en el mismo formulario: son exactamente los mismos campos, y
 * tener dos copias garantizaba que una se quedara atrás al agregar uno nuevo
 * —que es justo lo que pasó con el alcance por cuentas—.
 */
function BudgetSheet({
  open,
  onOpenChange,
  spaceId,
  currency,
  budget,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  spaceId: string;
  currency: string;
  budget?: BudgetWithStatus;
}) {
  const queryClient = useQueryClient();
  const categories = useCategories(spaceId, "EXPENSE");
  // Se piden también las archivadas para poder FILTRARLAS abajo: una archivada
  // que ya está en el presupuesto tiene que seguir viéndose, o quedaría
  // seleccionada sin chip y no habría forma de sacarla.
  const accounts = useAccounts(spaceId, true);
  const exponent = getCurrencyExponent(currency);
  const isEdit = budget !== undefined;

  const [name, setName] = useState(budget?.name ?? "");
  const [amount, setAmount] = useState(
    budget === undefined
      ? ""
      : minorToInput(budget.amount.amountMinor, exponent),
  );
  const [period, setPeriod] = useState<BudgetPeriod>(
    budget?.period ?? "MONTHLY",
  );
  const [categoryId, setCategoryId] = useState<string | null>(
    budget?.category?.id ?? null,
  );
  const [accountIds, setAccountIds] = useState<string[]>(
    budget === undefined ? [] : budget.accounts.map((account) => account.id),
  );
  const [rollover, setRollover] = useState(budget?.rollover ?? false);
  const [endDate, setEndDate] = useState(budget?.endDate ?? "");

  const toggleAccount = (accountId: string): void => {
    setAccountIds((current) =>
      current.includes(accountId)
        ? current.filter((id) => id !== accountId)
        : [...current, accountId],
    );
  };

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name,
        // El input pide unidades mayores; se convierte a mínimas acá, con
        // enteros y sin pasar por parseFloat.
        amountMinor: toMinor(amount, exponent),
        period,
        categoryId,
        accountIds,
        rollover,
        // Se manda null y no se omite: al pasar de período fijo a mensual hay
        // que BORRAR la fecha de fin, no dejar la vieja puesta.
        endDate: period === "CUSTOM" && endDate !== "" ? endDate : null,
      };

      return isEdit
        ? api.patch(`/spaces/${spaceId}/budgets/${budget.id}`, body)
        : api.post(`/spaces/${spaceId}/budgets`, body);
    },
    onSuccess: async () => {
      toast.success(isEdit ? "Presupuesto actualizado" : "Presupuesto creado");
      // El formulario de alta queda montado entre aperturas —el de edición se
      // remonta con su `key`—, así que se limpia a mano para que el próximo
      // "Nuevo" no arranque con los datos del anterior.
      if (!isEdit) {
        setName("");
        setAmount("");
        setCategoryId(null);
        setAccountIds([]);
        setEndDate("");
      }
      onOpenChange(false);
      await queryClient.invalidateQueries({ queryKey: spaceScopeKey(spaceId) });
    },
    onError: (error: unknown) => {
      toast.error(
        error instanceof ApiError ? error.message : "No se pudo guardar",
      );
    },
  });

  const canSave =
    name.trim() !== "" &&
    /^\d+([.,]\d+)?$/.test(amount) &&
    Number(amount.replace(",", ".")) > 0 &&
    (period !== "CUSTOM" || endDate !== "") &&
    !save.isPending;

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[90dvh] pb-safe-bottom">
        <DrawerHeader className="text-left">
          <DrawerTitle>
            {isEdit ? "Editar presupuesto" : "Nuevo presupuesto"}
          </DrawerTitle>
        </DrawerHeader>

        <DrawerBody className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="budget-name">Nombre</Label>
            <Input
              id="budget-name"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
              }}
              placeholder="Comida del mes"
              className="min-h-touch"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="budget-amount">Tope ({currency})</Label>
            <Input
              id="budget-amount"
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value);
              }}
              placeholder="500"
              inputMode="decimal"
              className="min-h-touch"
            />
          </div>

          <div className="space-y-2">
            <Label>Período</Label>
            <div className="flex flex-wrap gap-2">
              {BUDGET_PERIODS.map((option) => (
                <Chip
                  key={option}
                  active={period === option}
                  onClick={() => {
                    setPeriod(option);
                  }}
                >
                  {BUDGET_PERIOD_LABELS[option]}
                </Chip>
              ))}
            </div>
          </div>

          {period === "CUSTOM" && (
            <div className="space-y-1.5">
              <Label htmlFor="budget-end">Hasta</Label>
              <Input
                id="budget-end"
                type="date"
                value={endDate}
                onChange={(e) => {
                  setEndDate(e.target.value);
                }}
                className="min-h-touch"
              />
            </div>
          )}

          <div className="space-y-2">
            <Label>Categoría</Label>
            <div className="flex flex-wrap gap-2">
              <Chip
                active={categoryId === null}
                onClick={() => {
                  setCategoryId(null);
                }}
              >
                Todos los gastos
              </Chip>
              {(categories.data ?? []).map((category) => (
                <Chip
                  key={category.id}
                  active={categoryId === category.id}
                  onClick={() => {
                    setCategoryId(category.id);
                  }}
                >
                  {category.name}
                </Chip>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Un presupuesto de categoría incluye también sus subcategorías.
            </p>
          </div>

          <div className="space-y-2">
            <Label>Cuentas</Label>
            <div className="flex flex-wrap gap-2">
              <Chip
                active={accountIds.length === 0}
                onClick={() => {
                  setAccountIds([]);
                }}
              >
                Todas
              </Chip>
              {(accounts.data ?? [])
                .filter(
                  (account) =>
                    !account.isArchived || accountIds.includes(account.id),
                )
                .map((account) => (
                  <Chip
                    key={account.id}
                    active={accountIds.includes(account.id)}
                    onClick={() => {
                      toggleAccount(account.id);
                    }}
                  >
                    {account.name}
                  </Chip>
                ))}
            </div>
            <p className="text-xs text-muted-foreground">
              {accountIds.length === 0
                ? "Cuenta el gasto de todas las cuentas. Elegí algunas para hacer un tope aparte —por ejemplo, uno para las tarjetas y otro para el efectivo—."
                : "Solo cuenta el gasto pagado con las cuentas elegidas."}
            </p>
          </div>

          <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
            <div className="min-w-0">
              <Label htmlFor="budget-rollover">Arrastrar el saldo</Label>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Lo que sobre suma al período siguiente; lo que te pases, resta.
              </p>
            </div>
            <Switch
              id="budget-rollover"
              checked={rollover}
              onCheckedChange={setRollover}
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
              "Crear presupuesto"
            )}
          </Button>
        </DrawerBody>
      </DrawerContent>
    </Drawer>
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
