"use client";

import { ChevronDown, Loader2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { AmountPad } from "@/components/transactions/amount-pad";
import { CategoryGrid } from "@/components/transactions/category-grid";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError } from "@/lib/api-client";
import {
  useAccounts,
  useCategories,
  useCreateTransaction,
} from "@/lib/hooks/use-domain";
import { useActiveSpace, useSession } from "@/lib/hooks/use-session";
import { formatMoneyDTO } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { CategoryDTO } from "@/shared/contracts/categories";
import { todayIn } from "@/shared/dates";

/**
 * Carga rápida: EL flujo más importante de la app.
 *
 * Diseño: una sola pantalla, tres toques y listo — importe, categoría, cuenta.
 * La fecha es hoy y todo lo demás está plegado. Nada de wizards, ni de pasos,
 * ni de scroll obligatorio antes de poder guardar.
 *
 * El tipo por defecto es EXPENSE porque es lo que se carga el 90% de las
 * veces; el ingreso está a un toque.
 */
export default function NewTransactionPage() {
  const router = useRouter();
  const session = useSession();
  const { space } = useActiveSpace();
  const spaceId = space?.id ?? "";

  const [type, setType] = useState<"EXPENSE" | "INCOME">("EXPENSE");
  const [digits, setDigits] = useState("");
  const [category, setCategory] = useState<CategoryDTO | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [showMore, setShowMore] = useState(false);
  const [description, setDescription] = useState("");
  const [date, setDate] = useState("");

  const accounts = useAccounts(spaceId);
  const categories = useCategories(spaceId, type);
  const create = useCreateTransaction(spaceId);

  const locale = session.data?.locale ?? "es-ES";
  const timezone = session.data?.timezone ?? "Europe/Madrid";

  const active = accounts.data?.filter((a) => !a.isArchived) ?? [];
  const selectedAccount =
    active.find((a) => a.id === accountId) ?? active[0] ?? null;
  const currency = selectedAccount?.currency ?? space?.primaryCurrency ?? "EUR";

  const amount = digits === "" ? 0n : BigInt(digits);
  const canSave = amount > 0n && selectedAccount !== null && !create.isPending;

  const submit = (): void => {
    // `canSave` ya incluye que haya cuenta seleccionada; TS lo estrecha solo.
    if (!canSave) return;

    create.mutate(
      {
        accountId: selectedAccount.id,
        categoryId: category?.id ?? null,
        type,
        amountMinor: digits,
        ...(description.trim() !== ""
          ? { description: description.trim() }
          : {}),
        ...(date !== "" ? { date } : {}),
      },
      {
        onSuccess: () => {
          toast.success(
            type === "EXPENSE" ? "Gasto registrado" : "Ingreso registrado",
          );
          router.replace("/transactions");
        },
        onError: (error: unknown) => {
          toast.error(
            error instanceof ApiError
              ? error.message
              : "No se pudo guardar el movimiento",
          );
        },
      },
    );
  };

  return (
    <div className="flex min-h-full flex-col gap-5 py-3">
      <header className="flex items-center justify-between">
        <Button
          variant="ghost"
          size="icon"
          className="-ml-2 min-h-touch min-w-touch"
          onClick={() => {
            router.back();
          }}
          aria-label="Cancelar"
        >
          <X className="size-5" />
        </Button>

        {/* Gasto / ingreso como segmentado: un toque, sin desplegables. */}
        <div className="flex rounded-full bg-secondary p-1">
          {(["EXPENSE", "INCOME"] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => {
                setType(option);
                setCategory(null);
              }}
              className={cn(
                "min-h-touch rounded-full px-5 text-sm font-medium",
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

        <span className="w-10" />
      </header>

      <AmountPad
        digits={digits}
        currency={currency}
        locale={locale}
        onChange={setDigits}
      />

      <section className="space-y-2">
        <h2 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Categoría
        </h2>
        {categories.data === undefined ? (
          <div className="grid grid-cols-4 gap-2">
            {Array.from({ length: 8 }, (_unused, i) => (
              <Skeleton key={i} className="h-20 rounded-xl" />
            ))}
          </div>
        ) : (
          <CategoryGrid
            categories={categories.data}
            selectedId={category?.id ?? null}
            onSelect={setCategory}
          />
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Cuenta
        </h2>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {active.map((account) => (
            <button
              key={account.id}
              type="button"
              onClick={() => {
                setAccountId(account.id);
              }}
              aria-pressed={account.id === selectedAccount?.id}
              className={cn(
                "min-h-touch shrink-0 rounded-xl border px-3 py-2 text-left",
                account.id === selectedAccount?.id && "ring-2 ring-primary",
              )}
            >
              <span className="block text-sm font-medium">{account.name}</span>
              <span className="block text-xs text-muted-foreground tabular-nums">
                {formatMoneyDTO(account.balance, locale)}
              </span>
            </button>
          ))}
        </div>
      </section>

      {/* Todo lo opcional, plegado. Que no estorbe al camino de tres toques. */}
      <section>
        <button
          type="button"
          onClick={() => {
            setShowMore(!showMore);
          }}
          className="flex min-h-touch items-center gap-1 text-sm text-muted-foreground"
          aria-expanded={showMore}
        >
          Más detalles
          <ChevronDown
            className={cn(
              "size-4 transition-transform",
              showMore && "rotate-180",
            )}
          />
        </button>

        {showMore && (
          <div className="mt-3 space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="description">Descripción</Label>
              <Input
                id="description"
                value={description}
                onChange={(e) => {
                  setDescription(e.target.value);
                }}
                placeholder="Opcional"
                className="min-h-touch"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="date">Fecha</Label>
              <Input
                id="date"
                type="date"
                value={date === "" ? todayIn(timezone) : date}
                onChange={(e) => {
                  setDate(e.target.value);
                }}
                className="min-h-touch"
              />
            </div>
          </div>
        )}
      </section>

      {/* Botón fijo al fondo, sobre la safe area: siempre alcanzable con el
          pulgar sin scrollear. */}
      <div className="sticky bottom-0 -mx-4 mt-auto bg-linear-to-t from-background via-background to-transparent px-4 pt-6 pb-2">
        <Button
          className="h-13 min-h-touch w-full text-base"
          disabled={!canSave}
          onClick={submit}
        >
          {create.isPending ? (
            <Loader2 className="size-5 animate-spin" />
          ) : (
            `Guardar ${type === "EXPENSE" ? "gasto" : "ingreso"}`
          )}
        </Button>
      </div>
    </div>
  );
}
