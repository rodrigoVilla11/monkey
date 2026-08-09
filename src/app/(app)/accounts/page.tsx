"use client";

import * as Icons from "lucide-react";
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
import { ApiError } from "@/lib/api-client";
import {
  formatMoneyDTO,
  isAmountInput,
  minorToInput,
  toMinor,
} from "@/lib/format";
import {
  useAccounts,
  useArchiveAccount,
  useCreateAccount,
  useDeleteAccount,
  useUpdateAccount,
} from "@/lib/hooks/use-domain";
import { useActiveSpace, useSession } from "@/lib/hooks/use-session";
import { cn } from "@/lib/utils";
import {
  ACCOUNT_TYPES,
  ACCOUNT_TYPE_LABELS,
  type AccountType,
  type AccountWithBalance,
} from "@/shared/contracts/accounts";
import { SUGGESTED_CURRENCIES, getCurrencyExponent } from "@/shared/currency";
import { hasAtLeast } from "@/shared/roles";

export default function AccountsPage() {
  const session = useSession();
  const { space } = useActiveSpace();
  const spaceId = space?.id ?? "";
  const [showArchived, setShowArchived] = useState(false);
  const [showNew, setShowNew] = useState(false);

  /**
   * La cuenta que se está editando se guarda aunque el drawer ya se esté
   * cerrando: si se borrara al toque, el panel se vaciaría a mitad de la
   * animación de salida.
   */
  const [editing, setEditing] = useState<AccountWithBalance | null>(null);
  const [editOpen, setEditOpen] = useState(false);

  const accounts = useAccounts(spaceId, showArchived);

  const locale = session.data?.locale ?? "es-ES";
  const canEdit = space !== undefined && hasAtLeast(space.role, "MEMBER");
  const canDelete = space !== undefined && hasAtLeast(space.role, "ADMIN");

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
            <AccountRow
              key={account.id}
              account={account}
              locale={locale}
              canEdit={canEdit}
              onEdit={() => {
                setEditing(account);
                setEditOpen(true);
              }}
            />
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

      {editing !== null && (
        <EditAccountSheet
          // Reabrir con otra cuenta tiene que reiniciar el formulario, no
          // arrastrar lo tecleado en la anterior.
          key={editing.id}
          open={editOpen}
          onOpenChange={setEditOpen}
          spaceId={spaceId}
          account={editing}
          canDelete={canDelete}
        />
      )}
    </div>
  );
}

function AccountRow({
  account,
  locale,
  canEdit,
  onEdit,
}: {
  account: AccountWithBalance;
  locale: string;
  canEdit: boolean;
  onEdit: () => void;
}) {
  const body = (
    <>
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
        <p className="flex items-center gap-1.5 truncate font-medium">
          {account.name}
          {/* La principal se marca en la fila: es la que va a aparecer sola
              al cargar, y saber cuál es sin abrir nada evita la sorpresa. */}
          {account.isDefault && (
            <span className="shrink-0 rounded-full bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
              Principal
            </span>
          )}
        </p>
        <p className="text-xs text-muted-foreground">
          {ACCOUNT_TYPE_LABELS[account.type]} · {account.currency}
          {account.transactionCount > 0 &&
            ` · ${String(account.transactionCount)} mov.`}
        </p>
        {/* Solo se dice cuando NO cuenta: lo normal es que sí, y repetirlo en
            cada fila sería ruido. */}
        {!account.includeInNetWorth && (
          <p className="text-xs text-muted-foreground">Fuera del inicio</p>
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
        {/* El equivalente en la moneda del Space, al tipo de hoy. Va debajo y
            en pequeño: el saldo REAL es el de arriba, este es una referencia. */}
        {account.balancePrimary !== null && (
          <p className="text-xs text-muted-foreground tabular-nums">
            ≈ {formatMoneyDTO(account.balancePrimary, locale)}
          </p>
        )}
      </div>

      {canEdit && (
        <Icons.ChevronRight className="size-4 shrink-0 text-muted-foreground" />
      )}
    </>
  );

  const shell = cn(
    "flex w-full items-center gap-3 p-4 text-left",
    account.isArchived && "opacity-60",
  );

  return (
    <Card className="gap-0 overflow-hidden p-0">
      {canEdit ? (
        // Toda la fila abre la edición: en un teléfono, un lápiz de 16px al
        // costado es un blanco imposible.
        <button type="button" onClick={onEdit} className={shell}>
          {body}
        </button>
      ) : (
        <div className={shell}>{body}</div>
      )}
    </Card>
  );
}

/**
 * Los campos que comparten crear y editar.
 *
 * La moneda no está acá: al crear se elige y al editar no se puede cambiar,
 * así que cada pantalla la resuelve a su manera.
 */
function AccountFields({
  name,
  onName,
  type,
  onType,
  balance,
  onBalance,
  balanceLabel,
  balanceHint,
  currency,
  closingDay,
  onClosingDay,
  dueDay,
  onDueDay,
  includeInNetWorth,
  onIncludeInNetWorth,
}: {
  name: string;
  onName: (value: string) => void;
  type: AccountType;
  onType: (value: AccountType) => void;
  balance: string;
  onBalance: (value: string) => void;
  balanceLabel: string;
  balanceHint: string;
  currency: string;
  closingDay: string;
  onClosingDay: (value: string) => void;
  dueDay: string;
  onDueDay: (value: string) => void;
  includeInNetWorth: boolean;
  onIncludeInNetWorth: (value: boolean) => void;
}) {
  return (
    <>
      <div className="space-y-1.5">
        <Label htmlFor="account-name">Nombre</Label>
        <Input
          id="account-name"
          value={name}
          onChange={(e) => {
            onName(e.target.value);
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
                onType(option);
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
        <Label htmlFor="account-balance">
          {balanceLabel} ({currency})
        </Label>
        <Input
          id="account-balance"
          value={balance}
          onChange={(e) => {
            onBalance(e.target.value);
          }}
          inputMode="decimal"
          placeholder="0"
          className="min-h-touch tabular-nums"
        />
        <p className="text-xs text-muted-foreground">{balanceHint}</p>
      </div>

      {/* Cierre y vencimiento solo existen en una tarjeta. Hay un CHECK en la
          base que lo garantiza; mostrarlos siempre invitaría a un 422. */}
      {type === "CREDIT_CARD" && (
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="account-closing">Día de cierre</Label>
            <Input
              id="account-closing"
              value={closingDay}
              onChange={(e) => {
                onClosingDay(e.target.value);
              }}
              inputMode="numeric"
              placeholder="25"
              className="min-h-touch tabular-nums"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="account-due">Día de vencimiento</Label>
            <Input
              id="account-due"
              value={dueDay}
              onChange={(e) => {
                onDueDay(e.target.value);
              }}
              inputMode="numeric"
              placeholder="10"
              className="min-h-touch tabular-nums"
            />
          </div>
        </div>
      )}

      {/* Interruptor único: aparecer en el inicio y sumar al patrimonio son lo
          mismo. Separarlos daría un total imposible de explicar mirando la
          lista. */}
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
          onCheckedChange={onIncludeInNetWorth}
        />
      </div>
    </>
  );
}

/** Un día del mes tecleado, o null si el campo quedó vacío o no sirve. */
const parseDay = (value: string): number | null => {
  const day = Number(value.trim());
  if (!Number.isInteger(day) || day < 1 || day > 31) return null;
  return day;
};

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
  const [balance, setBalance] = useState("");
  const [closingDay, setClosingDay] = useState("");
  const [dueDay, setDueDay] = useState("");
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

  const balanceInvalid = balance !== "" && !isAmountInput(balance);

  const submit = (): void => {
    create.mutate(
      {
        name,
        type,
        currency,
        includeInNetWorth,
        initialBalanceMinor:
          balance === ""
            ? "0"
            : toMinor(balance, getCurrencyExponent(currency)),
        ...(type === "CREDIT_CARD"
          ? {
              creditClosingDay: parseDay(closingDay),
              creditDueDay: parseDay(dueDay),
            }
          : {}),
      },
      {
        onSuccess: () => {
          toast.success("Cuenta creada");
          setName("");
          setBalance("");
          setClosingDay("");
          setDueDay("");
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

        <DrawerBody className="space-y-4">
          <AccountFields
            name={name}
            onName={setName}
            type={type}
            onType={setType}
            balance={balance}
            onBalance={setBalance}
            balanceLabel="Saldo inicial"
            balanceHint="Lo que hay hoy en la cuenta, antes de cargar ningún movimiento. En una tarjeta puede ser negativo."
            currency={currency}
            closingDay={closingDay}
            onClosingDay={setClosingDay}
            dueDay={dueDay}
            onDueDay={setDueDay}
            includeInNetWorth={includeInNetWorth}
            onIncludeInNetWorth={setIncludeInNetWorth}
          />

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
              {currency === defaultCurrency
                ? "Después no se puede cambiar: los movimientos ya cargados quedarían en una moneda que la cuenta ya no tiene."
                : `El saldo se guarda en ${currency}. En el inicio se muestra convertido a ${defaultCurrency} con la última cotización que tengas cargada — si falta, lo dice en vez de inventarla. Después no se puede cambiar.`}
            </p>
          </div>

          <Button
            className="min-h-touch w-full"
            disabled={name.trim() === "" || balanceInvalid || create.isPending}
            onClick={submit}
          >
            {create.isPending ? (
              <Icons.Loader2 className="size-4 animate-spin" />
            ) : (
              "Crear cuenta"
            )}
          </Button>
        </DrawerBody>
      </DrawerContent>
    </Drawer>
  );
}

function EditAccountSheet({
  open,
  onOpenChange,
  spaceId,
  account,
  canDelete,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  spaceId: string;
  account: AccountWithBalance;
  canDelete: boolean;
}) {
  const exponent = getCurrencyExponent(account.currency);

  const [name, setName] = useState(account.name);
  const [type, setType] = useState<AccountType>(account.type);
  const [balance, setBalance] = useState(
    minorToInput(account.initialBalanceMinor, exponent),
  );
  const [closingDay, setClosingDay] = useState(
    account.creditClosingDay === null ? "" : String(account.creditClosingDay),
  );
  const [dueDay, setDueDay] = useState(
    account.creditDueDay === null ? "" : String(account.creditDueDay),
  );
  const [includeInNetWorth, setIncludeInNetWorth] = useState(
    account.includeInNetWorth,
  );
  const [isDefault, setIsDefault] = useState(account.isDefault);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const update = useUpdateAccount(spaceId);
  const archive = useArchiveAccount(spaceId);
  const remove = useDeleteAccount(spaceId);

  const balanceInvalid = balance !== "" && !isAmountInput(balance);

  const submit = (): void => {
    update.mutate(
      {
        id: account.id,
        name,
        // El tipo va siempre, aunque no se haya tocado: la validación de los
        // días de tarjeta lo mira, y sin él un cierre válido daría 422.
        type,
        includeInNetWorth,
        // Solo se manda si cambió: mandar `false` sobre la que ya era
        // principal la dejaría sin ninguna, que no es lo que nadie pidió.
        ...(isDefault === account.isDefault ? {} : { isDefault }),
        initialBalanceMinor: balance === "" ? "0" : toMinor(balance, exponent),
        ...(type === "CREDIT_CARD"
          ? {
              creditClosingDay: parseDay(closingDay),
              creditDueDay: parseDay(dueDay),
            }
          : {}),
      },
      {
        onSuccess: () => {
          toast.success("Cuenta actualizada");
          onOpenChange(false);
        },
        onError: (error: unknown) => {
          toast.error(
            error instanceof ApiError ? error.message : "No se pudo guardar",
          );
        },
      },
    );
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="pb-safe-bottom">
        <DrawerHeader className="text-left">
          <DrawerTitle>Editar cuenta</DrawerTitle>
        </DrawerHeader>

        <DrawerBody className="space-y-4">
          <AccountFields
            name={name}
            onName={setName}
            type={type}
            onType={setType}
            balance={balance}
            onBalance={setBalance}
            balanceLabel="Saldo inicial"
            balanceHint={
              account.transactionCount > 0
                ? `Es el saldo de apertura, no el actual. Cambiarlo mueve el saldo de la cuenta y los ${String(account.transactionCount)} movimientos quedan como están.`
                : "El saldo de apertura de la cuenta, antes de cargar ningún movimiento."
            }
            currency={account.currency}
            closingDay={closingDay}
            onClosingDay={setClosingDay}
            dueDay={dueDay}
            onDueDay={setDueDay}
            includeInNetWorth={includeInNetWorth}
            onIncludeInNetWorth={setIncludeInNetWorth}
          />

          {/* Va en editar y no en crear: se elige entre las que ya existen, y
              la primera cuenta del Space queda principal sola. */}
          <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
            <div className="min-w-0">
              <Label htmlFor="account-default">Cuenta principal</Label>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {account.isDefault
                  ? "Es la que viene elegida al cargar un movimiento o una transferencia. Para cambiarla, marcá otra: hay una sola por espacio."
                  : "Viene elegida al cargar un movimiento o una transferencia. Marcarla se la saca a la que lo sea hoy."}
              </p>
            </div>
            <Switch
              id="account-default"
              checked={isDefault}
              // Desmarcar la principal dejaría al espacio sin ninguna; se
              // cambia marcando otra, que es lo que la gente quiere decir.
              disabled={account.isDefault}
              onCheckedChange={setIsDefault}
            />
          </div>

          <p className="text-xs text-muted-foreground">
            La moneda ({account.currency}) no se puede cambiar: los movimientos
            ya cargados quedarían expresados en una moneda que la cuenta ya no
            tiene. Si te equivocaste, creá otra cuenta y archivá esta.
          </p>

          <Button
            className="min-h-touch w-full"
            disabled={name.trim() === "" || balanceInvalid || update.isPending}
            onClick={submit}
          >
            {update.isPending ? (
              <Icons.Loader2 className="size-4 animate-spin" />
            ) : (
              "Guardar cambios"
            )}
          </Button>

          <div className="space-y-3 border-t pt-4">
            <Button
              variant="outline"
              className="min-h-touch w-full"
              disabled={archive.isPending}
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
                      onOpenChange(false);
                    },
                    onError: (error: unknown) => {
                      toast.error(
                        error instanceof ApiError
                          ? error.message
                          : "No se pudo archivar",
                      );
                    },
                  },
                );
              }}
            >
              {account.isArchived ? "Restaurar cuenta" : "Archivar cuenta"}
            </Button>
            <p className="text-xs text-muted-foreground">
              Archivar la saca de las listas y del inicio sin tocar nada de lo
              ya cargado. Es lo que hay que hacer con una cuenta que se cerró.
            </p>

            {/* Eliminar solo lo ve un ADMIN, y solo tiene sentido en una cuenta
                sin movimientos: con movimientos el servidor responde 409. Se
                oculta en vez de mostrarla y que falle. */}
            {canDelete && account.transactionCount === 0 && (
              <div className="space-y-2">
                {confirmDelete ? (
                  <div className="space-y-2 rounded-lg border border-destructive/40 p-3">
                    <p className="text-sm">
                      Se elimina «{account.name}». No se puede deshacer.
                    </p>
                    <div className="flex gap-2">
                      <Button
                        variant="destructive"
                        className="min-h-touch flex-1"
                        disabled={remove.isPending}
                        onClick={() => {
                          remove.mutate(account.id, {
                            onSuccess: () => {
                              toast.success("Cuenta eliminada");
                              onOpenChange(false);
                            },
                            onError: (error: unknown) => {
                              toast.error(
                                error instanceof ApiError
                                  ? error.message
                                  : "No se pudo eliminar",
                              );
                            },
                          });
                        }}
                      >
                        Sí, eliminar
                      </Button>
                      <Button
                        variant="outline"
                        className="min-h-touch flex-1"
                        onClick={() => {
                          setConfirmDelete(false);
                        }}
                      >
                        Cancelar
                      </Button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setConfirmDelete(true);
                    }}
                    className="min-h-touch text-sm text-destructive underline underline-offset-4"
                  >
                    Eliminar cuenta
                  </button>
                )}
              </div>
            )}
          </div>
        </DrawerBody>
      </DrawerContent>
    </Drawer>
  );
}
