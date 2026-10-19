"use client";

import { ArrowDown, Loader2, X } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { toast } from "sonner";

import { AmountPad } from "@/components/transactions/amount-pad";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api-client";
import { formatMoneyDTO, formatRate } from "@/lib/format";
import {
  useAccounts,
  useCreateTransfer,
  useRateLookup,
} from "@/lib/hooks/use-domain";
import { useActiveSpace, useSession } from "@/lib/hooks/use-session";
import { cn } from "@/lib/utils";
import { formatCalendarDate, todayIn } from "@/shared/dates";
import { convert, deriveRate, money } from "@/shared/money";

/**
 * Transferencia entre cuentas.
 *
 * Pantalla propia y no una pestaña más de la carga rápida: una transferencia
 * no tiene categoría, tiene dos cuentas en vez de una y, si las monedas
 * difieren, dos importes. Meterla en el mismo formulario obligaría a esconder
 * y mostrar medio flujo según el tipo elegido.
 *
 * **Entre monedas distintas, el cambio se hace solo y se puede corregir.** Lo
 * que salió se convierte con la cotización cargada para la fecha —la misma
 * función y la misma cotización que usaría el servidor— y se muestra como
 * importe de destino. Si el banco aplicó otra cotización o cobró comisión, un
 * toque abre el teclado para escribir cuánto llegó de verdad; de ahí sale la
 * cotización real, que es la que se congela. Sin cotización cargada, se pide
 * el importe a mano y se ofrece cargar una.
 */
function TransferForm() {
  const router = useRouter();
  const session = useSession();
  const { space } = useActiveSpace();
  const spaceId = space?.id ?? "";

  /**
   * Desde Cuentas se llega con `?from=<accountId>` para que la cuenta desde la
   * que se quiere mover plata ya venga elegida. Si el id no existe o está
   * archivado, el fallback de abajo elige la principal como siempre.
   */
  const search = useSearchParams();
  const [fromId, setFromId] = useState<string | null>(search.get("from"));
  const [toId, setToId] = useState<string | null>(null);
  const [digitsOut, setDigitsOut] = useState("");
  /**
   * El importe de destino escrito a mano, atado a la cuenta de destino: un
   * importe en pesos no significa nada si la cuenta ahora está en euros, así
   * que al cambiar de destino se vuelve a la propuesta automática.
   */
  const [manualIn, setManualIn] = useState<{
    accountId: string;
    digits: string;
  } | null>(null);
  const [description, setDescription] = useState("");
  const [date, setDate] = useState("");

  const accounts = useAccounts(spaceId);
  const create = useCreateTransfer(spaceId);

  const locale = session.data?.locale ?? "es-ES";
  const timezone = session.data?.timezone ?? "Europe/Madrid";
  const effectiveDate = date === "" ? todayIn(timezone) : date;

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

  const lookup = useRateLookup(
    spaceId,
    crossCurrency
      ? { base: from.currency, quote: to.currency, date: effectiveDate }
      : null,
  );
  const tableRate = lookup.data ?? null;

  const amountOut = digitsOut === "" ? 0n : BigInt(digitsOut);

  /**
   * La propuesta: lo que salió, convertido con la cotización cargada. Misma
   * función que el servidor (`shared/` es puro y el cliente lo importa tal
   * cual), así que lo que se ve es exactamente lo que se guardaría.
   */
  const suggested =
    crossCurrency && tableRate !== null && amountOut > 0n
      ? convert(money(amountOut, from.currency), tableRate.rate, to.currency)
      : null;
  const suggestedDigits =
    suggested?.ok === true && suggested.value.amountMinor > 0n
      ? suggested.value.amountMinor.toString()
      : null;

  const manual =
    manualIn !== null && manualIn.accountId === to?.id ? manualIn.digits : null;
  const editing = manual !== null || suggestedDigits === null;
  const digitsIn = manual ?? suggestedDigits ?? "";
  const amountIn = digitsIn === "" ? 0n : BigInt(digitsIn);

  // Cotización real de la operación, a partir de los dos importes.
  const derived =
    crossCurrency && amountOut > 0n && amountIn > 0n
      ? deriveRate(
          money(amountOut, from.currency),
          money(amountIn, to.currency),
        )
      : null;
  const realRate = derived?.ok === true ? derived.value : null;

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
        // Se manda siempre lo que se mostró, propuesto o corregido: lo que
        // el usuario vio es lo que se guarda, aunque la cotización cambie.
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
        <section className="space-y-3 rounded-xl border border-dashed p-3">
          <p className="text-sm font-medium">¿Cuánto entra en {to.name}?</p>

          {!editing ? (
            <>
              {/* Propuesta calculada: un número grande y de dónde salió. */}
              <p className="text-center text-2xl font-semibold tabular-nums">
                {formatMoneyDTO(
                  { amountMinor: digitsIn, currency: to.currency },
                  locale,
                )}
              </p>
              {tableRate !== null && (
                <p className="text-center text-xs text-muted-foreground tabular-nums">
                  Calculado con la cotización del{" "}
                  {formatCalendarDate(tableRate.date, locale, {
                    day: "numeric",
                    month: "short",
                  })}
                  : 1 {from.currency} = {formatRate(tableRate.rate, locale)}{" "}
                  {to.currency}
                </p>
              )}
              <Button
                type="button"
                variant="outline"
                className="min-h-touch w-full"
                onClick={() => {
                  setManualIn({ accountId: to.id, digits: "" });
                }}
              >
                El banco aplicó otra cotización
              </Button>
            </>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">
                El importe que figura en el extracto, con comisiones incluidas.
                De ahí sale la cotización real de la operación.
              </p>
              <AmountPad
                digits={manual ?? ""}
                currency={to.currency}
                locale={locale}
                onChange={(digits) => {
                  setManualIn({ accountId: to.id, digits });
                }}
              />
              {realRate !== null && (
                <p className="text-center text-xs text-muted-foreground tabular-nums">
                  Cotización real: 1 {from.currency} ={" "}
                  {formatRate(realRate, locale)} {to.currency}
                </p>
              )}
              {tableRate !== null ? (
                <Button
                  type="button"
                  variant="ghost"
                  className="min-h-touch w-full text-xs"
                  onClick={() => {
                    setManualIn(null);
                  }}
                >
                  Usar la cotización cargada (1 {from.currency} ={" "}
                  {formatRate(tableRate.rate, locale)} {to.currency})
                </Button>
              ) : lookup.isPending && lookup.fetchStatus !== "idle" ? (
                <p className="text-center text-xs text-muted-foreground">
                  Buscando cotización…
                </p>
              ) : (
                <p className="text-center text-xs text-muted-foreground">
                  No hay cotización {from.currency} → {to.currency} cargada.{" "}
                  <Link href="/settings/rates" className="underline">
                    Cargá una
                  </Link>{" "}
                  para que el importe se calcule solo la próxima vez.
                </p>
              )}
            </>
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
            value={effectiveDate}
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

/**
 * `useSearchParams` exige un límite de Suspense para el prerender estático;
 * sin él, el build de Next falla en esta ruta.
 */
export default function TransferPage() {
  return (
    <Suspense>
      <TransferForm />
    </Suspense>
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
