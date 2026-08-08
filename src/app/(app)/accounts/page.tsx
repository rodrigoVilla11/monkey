"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import * as Icons from "lucide-react";
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
import { Switch } from "@/components/ui/switch";
import { ApiError, api } from "@/lib/api-client";
import { formatMoneyDTO } from "@/lib/format";
import {
  useAccounts,
  useArchiveAccount,
  useCreateAccount,
} from "@/lib/hooks/use-domain";
import { useActiveSpace, useSession } from "@/lib/hooks/use-session";
import { spaceScopeKey } from "@/lib/query-keys";
import { cn } from "@/lib/utils";
import {
  ACCOUNT_TYPES,
  ACCOUNT_TYPE_LABELS,
  type AccountType,
  type AccountWithBalance,
} from "@/shared/contracts/accounts";
import { SUGGESTED_CURRENCIES } from "@/shared/currency";
import { hasAtLeast } from "@/shared/roles";

export default function AccountsPage() {
  const session = useSession();
  const { space } = useActiveSpace();
  const spaceId = space?.id ?? "";
  const [showArchived, setShowArchived] = useState(false);
  const [showNew, setShowNew] = useState(false);

  const accounts = useAccounts(spaceId, showArchived);
  const archive = useArchiveAccount(spaceId);

  const locale = session.data?.locale ?? "es-ES";
  const canEdit = space !== undefined && hasAtLeast(space.role, "MEMBER");

  return (
    <div className="space-y-4 py-3">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Cuentas</h1>
        {canEdit && (
          <Button
            size="sm"
            className="min-h-touch"
            onClick={() => {
              setShowNew(true);
            }}
          >
            <Icons.Plus className="size-4" />
            Nueva
          </Button>
        )}
      </div>

      {accounts.data === undefined ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }, (_unused, i) => (
            <Skeleton key={i} className="h-20 w-full rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          {accounts.data.map((account) => (
            <Card
              key={account.id}
              className={cn(
                "flex-row items-center gap-3 p-4",
                account.isArchived && "opacity-60",
              )}
            >
              <span
                className="flex size-10 shrink-0 items-center justify-center rounded-full"
                style={{ backgroundColor: `${account.color ?? "#71717a"}26` }}
              >
                <Icons.Wallet
                  className="size-5"
                  style={{ color: account.color ?? undefined }}
                />
              </span>

              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{account.name}</p>
                <p className="text-xs text-muted-foreground">
                  {ACCOUNT_TYPE_LABELS[account.type]} · {account.currency}
                  {account.transactionCount > 0 &&
                    ` · ${String(account.transactionCount)} mov.`}
                </p>
                {/* Solo se dice cuando NO cuenta: lo normal es que sí, y
                    repetirlo en cada fila sería ruido. */}
                {!account.includeInNetWorth && (
                  <p className="text-xs text-muted-foreground">
                    Fuera del inicio
                  </p>
                )}
              </div>

              <div className="text-right">
                <p
                  className={cn(
                    "font-semibold tabular-nums",
                    BigInt(account.balance.amountMinor) < 0n && "text-expense",
                  )}
                >
                  {formatMoneyDTO(account.balance, locale)}
                </p>
                {/* El equivalente en la moneda del Space, al tipo de hoy. Va
                    debajo y en pequeño: el saldo REAL es el de arriba, este es
                    una referencia. */}
                {account.balancePrimary !== null && (
                  <p className="text-xs text-muted-foreground tabular-nums">
                    ≈ {formatMoneyDTO(account.balancePrimary, locale)}
                  </p>
                )}
                {canEdit && (
                  <div className="flex justify-end gap-3">
                    <NetWorthToggle spaceId={spaceId} account={account} />
                    <button
                      type="button"
                      onClick={() => {
                        archive.mutate(
                          { id: account.id, archived: !account.isArchived },
                          {
                            onSuccess: () => {
                              toast.success(
                                account.isArchived
                                  ? "Cuenta restaurada"
                                  : "Cuenta archivada",
                              );
                            },
                          },
                        );
                      }}
                      className="text-xs text-muted-foreground underline underline-offset-4"
                    >
                      {account.isArchived ? "Restaurar" : "Archivar"}
                    </button>
                  </div>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={() => {
          setShowArchived(!showArchived);
        }}
        className="min-h-touch text-sm text-muted-foreground underline underline-offset-4"
      >
        {showArchived ? "Ocultar archivadas" : "Ver archivadas"}
      </button>

      <NewAccountSheet
        open={showNew}
        onOpenChange={setShowNew}
        spaceId={spaceId}
        defaultCurrency={space?.primaryCurrency ?? "EUR"}
      />
    </div>
  );
}

/**
 * Sacar o devolver una cuenta al inicio, sin abrir nada.
 *
 * Va en la propia fila y no en un formulario aparte porque es una decisión que
 * se cambia de opinión: "esta cuenta no la quiero en el resumen del día a día"
 * es algo que uno prueba y revierte.
 */
function NetWorthToggle({
  spaceId,
  account,
}: {
  spaceId: string;
  account: AccountWithBalance;
}) {
  const queryClient = useQueryClient();

  const toggle = useMutation({
    mutationFn: () =>
      api.patch(`/spaces/${spaceId}/accounts/${account.id}`, {
        includeInNetWorth: !account.includeInNetWorth,
      }),
    onSuccess: () => {
      toast.success(
        account.includeInNetWorth
          ? "Fuera del inicio"
          : "Vuelve a contar en el inicio",
      );
      // Se invalida el Space entero: esto cambia el patrimonio del dashboard.
      void queryClient.invalidateQueries({ queryKey: spaceScopeKey(spaceId) });
    },
    onError: (error: unknown) => {
      toast.error(
        error instanceof ApiError ? error.message : "No se pudo cambiar",
      );
    },
  });

  return (
    <button
      type="button"
      disabled={toggle.isPending}
      onClick={() => {
        toggle.mutate();
      }}
      className="text-xs text-muted-foreground underline underline-offset-4"
    >
      {account.includeInNetWorth ? "Sacar del inicio" : "Volver al inicio"}
    </button>
  );
}

function NewAccountSheet({
  open,
  onOpenChange,
  spaceId,
  defaultCurrency,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  spaceId: string;
  defaultCurrency: string;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState<AccountType>("BANK");
  const [currency, setCurrency] = useState(defaultCurrency);
  const [includeInNetWorth, setIncludeInNetWorth] = useState(true);
  const create = useCreateAccount(spaceId);

  /**
   * La del Space primero: es la que se elige casi siempre y tenerla que buscar
   * entre once sería absurdo.
   */
  const currencyOptions = [
    defaultCurrency,
    ...SUGGESTED_CURRENCIES.filter((option) => option !== defaultCurrency),
  ];

  const submit = (): void => {
    create.mutate(
      { name, type, currency, includeInNetWorth },
      {
        onSuccess: () => {
          toast.success("Cuenta creada");
          setName("");
          setCurrency(defaultCurrency);
          setIncludeInNetWorth(true);
          onOpenChange(false);
        },
        onError: (error: unknown) => {
          toast.error(
            error instanceof ApiError ? error.message : "No se pudo crear",
          );
        },
      },
    );
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="pb-safe-bottom">
        <DrawerHeader className="text-left">
          <DrawerTitle>Nueva cuenta</DrawerTitle>
        </DrawerHeader>

        <div className="space-y-4 px-4 pb-6">
          <div className="space-y-1.5">
            <Label htmlFor="account-name">Nombre</Label>
            <Input
              id="account-name"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
              }}
              placeholder="Cuenta corriente"
              className="min-h-touch"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Tipo</Label>
            <div className="flex flex-wrap gap-2">
              {ACCOUNT_TYPES.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => {
                    setType(option);
                  }}
                  aria-pressed={type === option}
                  className={cn(
                    "min-h-touch rounded-full border px-3 text-sm",
                    type === option &&
                      "border-primary bg-primary text-primary-foreground",
                  )}
                >
                  {ACCOUNT_TYPE_LABELS[option]}
                </button>
              ))}
            </div>
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
            {currency !== defaultCurrency && (
              <p className="text-xs text-muted-foreground">
                El saldo se guarda en {currency}. En el inicio se muestra
                convertido a {defaultCurrency} con la última cotización que
                tengas cargada — si falta, lo dice en vez de inventarla.
              </p>
            )}
          </div>

          {/* Interruptor único: aparecer en el inicio y sumar al patrimonio son
              lo mismo. Separarlos daría un total imposible de explicar mirando
              la lista. */}
          <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
            <div className="min-w-0">
              <Label htmlFor="account-networth">Contar en el inicio</Label>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Si lo desactivás, la cuenta no aparece en el resumen ni suma al
                patrimonio. Sus movimientos siguen contando en reportes y
                presupuestos.
              </p>
            </div>
            <Switch
              id="account-networth"
              checked={includeInNetWorth}
              onCheckedChange={setIncludeInNetWorth}
            />
          </div>

          <Button
            className="min-h-touch w-full"
            disabled={name.trim() === "" || create.isPending}
            onClick={submit}
          >
            {create.isPending ? (
              <Icons.Loader2 className="size-4 animate-spin" />
            ) : (
              "Crear cuenta"
            )}
          </Button>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
