"use client";

import { ArrowDown, Loader2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { AmountPad } from "@/components/transactions/amount-pad";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api-client";
import { formatMoneyDTO } from "@/lib/format";
import { useAccounts, useCreateTransfer } from "@/lib/hooks/use-domain";
import { useActiveSpace, useSession } from "@/lib/hooks/use-session";
import { cn } from "@/lib/utils";
import { todayIn } from "@/shared/dates";
import { deriveRate, money } from "@/shared/money";

/**
 * Transferencia entre cuentas.
 *
 * Pantalla propia y no una pestaña más de la carga rápida: una transferencia
 * no tiene categoría, tiene dos cuentas en vez de una y, si las monedas
 * difieren, dos importes. Meterla en el mismo formulario obligaría a esconder
 * y mostrar medio flujo según el tipo elegido.
 *
 * **El segundo importe aparece solo cuando hace falta.** Si las dos cuentas
 * están en la misma moneda no hay nada que preguntar: entra lo que sale. Si
 * difieren, se pide cuánto llegó de verdad —lo que dice el extracto, comisión
 * incluida— en vez de calcularlo con una cotización que nunca es la que aplicó
 * el banco.
 */
export default function TransferPage() {
  const router = useRouter();
  const session = useSession();
  const { space } = useActiveSpace();
  const spaceId = space?.id ?? "";

  const [fromId, setFromId] = useState<string | null>(null);
  const [toId, setToId] = useState<string | null>(null);
  const [digitsOut, setDigitsOut] = useState("");
  const [digitsIn, setDigitsIn] = useState("");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState("");

  const accounts = useAccounts(spaceId);
  const create = useCreateTransfer(spaceId);

  const locale = session.data?.locale ?? "es-ES";
  const timezone = session.data?.timezone ?? "Europe/Madrid";

  const active = accounts.data?.filter((a) => !a.isArchived) ?? [];
  // La principal es de donde sale la plata por defecto; el destino se elige.
  const from =
    active.find((a) => a.id === fromId) ??
    active.find((a) => a.isDefault) ??
    active[0] ??
    null;
  // El destino por defecto es la primera cuenta que NO sea el origen: elegir la
  // misma de los dos lados es el único caso imposible.
  const to =
    active.find((a) => a.id === toId && a.id !== from?.id) ??
    active.find((a) => a.id !== from?.id) ??
    null;

  const crossCurrency =
    from !== null && to !== null && from.currency !== to.currency;

  const amountOut = digitsOut === "" ? 0n : BigInt(digitsOut);
  const amountIn = digitsIn === "" ? 0n : BigInt(digitsIn);

  const rate =
    crossCurrency && amountOut > 0n && amountIn > 0n
      ? deriveRate(
          money(amountOut, from.currency),
          money(amountIn, to.currency),
        )
      : null;
  const preview = rate?.ok === true ? rate.value : null;

  const canSave =
    from !== null &&
    to !== null &&
    amountOut > 0n &&
    (!crossCurrency || amountIn > 0n) &&
    !create.isPending;

  const submit = (): void => {
    if (!canSave) return;

    create.mutate(
      {
        fromAccountId: from.id,
        toAccountId: to.id,
        amountOutMinor: digitsOut,
        ...(crossCurrency ? { amountInMinor: digitsIn } : {}),
        ...(description.trim() !== ""
          ? { description: description.trim() }
          : {}),
        ...(date !== "" ? { date } : {}),
      },
      {
        onSuccess: () => {
          toast.success("Transferencia registrada");
          router.replace("/transactions");
        },
        onError: (error: unknown) => {
          toast.error(
            error instanceof ApiError
              ? error.message
              : "No se pudo guardar la transferencia",
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
        <h1 className="text-base font-medium">Transferencia</h1>
        <span className="w-10" />
      </header>

      <AmountPad
        digits={digitsOut}
        currency={from?.currency ?? space?.primaryCurrency ?? "EUR"}
        locale={locale}
        onChange={setDigitsOut}
      />

      <section className="space-y-2">
        <h2 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Desde
        </h2>
        <AccountRow
          accounts={active}
          selectedId={from?.id ?? null}
          locale={locale}
          onSelect={(id) => {
            setFromId(id);
            // Si el destino pasa a ser el mismo, se libera para que el
            // fallback elija otro.
            if (id === to?.id) setToId(null);
          }}
        />
      </section>

      <div className="flex justify-center">
        <span className="flex size-8 items-center justify-center rounded-full bg-secondary">
          <ArrowDown className="size-4 text-muted-foreground" />
        </span>
      </div>

      <section className="space-y-2">
        <h2 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Hacia
        </h2>
        <AccountRow
          accounts={active.filter((a) => a.id !== from?.id)}
          selectedId={to?.id ?? null}
          locale={locale}
          onSelect={setToId}
        />
      </section>

      {/* Solo entre monedas distintas: si son iguales no hay nada que decidir. */}
      {crossCurrency && (
        <section className="space-y-2 rounded-xl border border-dashed p-3">
          <p className="text-sm font-medium">¿Cuánto entró en {to.name}?</p>
          <p className="text-xs text-muted-foreground">
            El importe que figura en el extracto, con comisiones incluidas. De
            ahí sale la cotización real de la operación.
          </p>
          <AmountPad
            digits={digitsIn}
            currency={to.currency}
            locale={locale}
            onChange={setDigitsIn}
          />
          {/* La cotización se previsualiza con la MISMA función que usa el
              servidor para congelarla: shared/ es puro y el cliente lo importa
              tal cual, así que lo que se ve acá es lo que se guarda. */}
          {preview !== null && (
            <p className="text-center text-xs text-muted-foreground tabular-nums">
              1 {from.currency} = {preview} {to.currency}
            </p>
          )}
        </section>
      )}

      <section className="space-y-3">
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
      </section>

      <div className="sticky bottom-0 -mx-4 mt-auto bg-linear-to-t from-background via-background to-transparent px-4 pt-6 pb-2">
        <Button
          className="h-13 min-h-touch w-full text-base"
          disabled={!canSave}
          onClick={submit}
        >
          {create.isPending ? (
            <Loader2 className="size-5 animate-spin" />
          ) : (
            "Transferir"
          )}
        </Button>
      </div>
    </div>
  );
}

function AccountRow({
  accounts,
  selectedId,
  locale,
  onSelect,
}: {
  accounts: readonly {
    id: string;
    name: string;
    currency: string;
    balance: { amountMinor: string; currency: string };
  }[];
  selectedId: string | null;
  locale: string;
  onSelect: (id: string) => void;
}) {
  if (accounts.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Hace falta otra cuenta para poder transferir
      </p>
    );
  }

  return (
    <div className="flex gap-2 overflow-x-auto pb-1">
      {accounts.map((account) => (
        <button
          key={account.id}
          type="button"
          onClick={() => {
            onSelect(account.id);
          }}
          aria-pressed={account.id === selectedId}
          className={cn(
            "min-h-touch shrink-0 rounded-xl border px-3 py-2 text-left",
            account.id === selectedId && "ring-2 ring-primary",
          )}
        >
          <span className="block text-sm font-medium">{account.name}</span>
          <span className="block text-xs text-muted-foreground tabular-nums">
            {formatMoneyDTO(account.balance, locale)}
          </span>
        </button>
      ))}
    </div>
  );
}
