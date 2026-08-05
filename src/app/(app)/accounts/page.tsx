"use client";

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
import { ApiError } from "@/lib/api-client";
import { formatMoneyDTO } from "@/lib/format";
import {
  useAccounts,
  useArchiveAccount,
  useCreateAccount,
} from "@/lib/hooks/use-domain";
import { useActiveSpace, useSession } from "@/lib/hooks/use-session";
import { cn } from "@/lib/utils";
import {
  ACCOUNT_TYPES,
  ACCOUNT_TYPE_LABELS,
  type AccountType,
} from "@/shared/contracts/accounts";
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
                {canEdit && (
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
  const create = useCreateAccount(spaceId);

  const submit = (): void => {
    create.mutate(
      { name, type },
      {
        onSuccess: () => {
          toast.success("Cuenta creada");
          setName("");
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

          <p className="text-xs text-muted-foreground">
            La moneda será {defaultCurrency}, la del espacio. Podés crear
            cuentas en otra moneda desde el detalle.
          </p>

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
