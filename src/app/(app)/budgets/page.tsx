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
import { toMinor } from "@/lib/format";
import { useCategories } from "@/lib/hooks/use-domain";
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
            Poné un tope a una categoría y te avisamos cuando te estés
            acercando.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {budgets.data.map((budget) => (
            <Card key={budget.id} className="p-4">
              <BudgetBar budget={budget} locale={locale} />
              {canEdit && <DeleteButton spaceId={spaceId} budget={budget} />}
            </Card>
          ))}
        </div>
      )}

      <NewBudgetSheet
        open={showNew}
        onOpenChange={setShowNew}
        spaceId={spaceId}
        currency={space?.primaryCurrency ?? "EUR"}
      />
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

function NewBudgetSheet({
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
  const categories = useCategories(spaceId, "EXPENSE");

  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [period, setPeriod] = useState<BudgetPeriod>("MONTHLY");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [rollover, setRollover] = useState(false);
  const [endDate, setEndDate] = useState("");

  const exponent = getCurrencyExponent(currency);

  const create = useMutation({
    mutationFn: () =>
      api.post(`/spaces/${spaceId}/budgets`, {
        name,
        // El input pide unidades mayores; se convierte a mínimas acá, con
        // enteros y sin pasar por parseFloat.
        amountMinor: toMinor(amount, exponent),
        period,
        categoryId,
        rollover,
        ...(period === "CUSTOM" && endDate !== "" ? { endDate } : {}),
      }),
    onSuccess: async () => {
      toast.success("Presupuesto creado");
      setName("");
      setAmount("");
      setCategoryId(null);
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
    /^\d+([.,]\d+)?$/.test(amount) &&
    Number(amount.replace(",", ".")) > 0 &&
    (period !== "CUSTOM" || endDate !== "") &&
    !create.isPending;

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[90dvh] pb-safe-bottom">
        <DrawerHeader className="text-left">
          <DrawerTitle>Nuevo presupuesto</DrawerTitle>
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
                <button
                  key={option}
                  type="button"
                  onClick={() => {
                    setPeriod(option);
                  }}
                  aria-pressed={period === option}
                  className={cn(
                    "min-h-touch rounded-full border px-3 text-sm",
                    period === option &&
                      "border-primary bg-primary text-primary-foreground",
                  )}
                >
                  {BUDGET_PERIOD_LABELS[option]}
                </button>
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
              <button
                type="button"
                onClick={() => {
                  setCategoryId(null);
                }}
                aria-pressed={categoryId === null}
                className={cn(
                  "min-h-touch rounded-full border px-3 text-sm",
                  categoryId === null &&
                    "border-primary bg-primary text-primary-foreground",
                )}
              >
                Todos los gastos
              </button>
              {(categories.data ?? []).map((category) => (
                <button
                  key={category.id}
                  type="button"
                  onClick={() => {
                    setCategoryId(category.id);
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
            <p className="text-xs text-muted-foreground">
              Un presupuesto de categoría incluye también sus subcategorías.
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
              create.mutate();
            }}
          >
            {create.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              "Crear presupuesto"
            )}
          </Button>
        </DrawerBody>
      </DrawerContent>
    </Drawer>
  );
}
