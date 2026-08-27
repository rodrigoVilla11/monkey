"use client";

import {
  Check,
  Loader2,
  Pencil,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { AttachmentsPanel } from "@/components/transactions/attachments-panel";
import { CategoryGrid } from "@/components/transactions/category-grid";
import { SplitPanel } from "@/components/transactions/split-panel";
import { TransactionList } from "@/components/transactions/transaction-list";
import { Button } from "@/components/ui/button";
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
import { ApiError } from "@/lib/api-client";
import {
  useAccounts,
  useCategories,
  useMembers,
  useTransactions,
  useUpdateTransaction,
} from "@/lib/hooks/use-domain";
import { useActiveSpace, useSession } from "@/lib/hooks/use-session";
import { useDebounced } from "@/lib/hooks/use-debounced";
import { cn } from "@/lib/utils";
import {
  formatSignedAmount,
  isAmountInput,
  minorToInput,
  toMinor,
} from "@/lib/format";
import { getCurrencyExponent } from "@/shared/currency";
import { formatCalendarDate } from "@/shared/dates";
import { hasAtLeast } from "@/shared/roles";
import type {
  TransactionDTO,
  TransactionFilters,
} from "@/shared/contracts/transactions";

/**
 * Listado de movimientos con buscador y filtros.
 *
 * Los filtros viven en el estado de esta pantalla y no en la URL: es una vista
 * de consulta, no algo que uno comparta por link, y meterlos en la URL haría
 * que el botón "atrás" del teléfono deshaga filtros de a uno.
 */
export default function TransactionsPage() {
  const session = useSession();
  const { space } = useActiveSpace();
  const spaceId = space?.id ?? "";

  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<TransactionFilters>({});
  const [showFilters, setShowFilters] = useState(false);
  const [selected, setSelected] = useState<TransactionDTO | null>(null);
  const [editing, setEditing] = useState<TransactionDTO | null>(null);

  // El buscador espera a que se deje de escribir: sin esto, cada tecla dispara
  // un request y la lista parpadea.
  const debouncedSearch = useDebounced(search, 300);

  const effective = useMemo<TransactionFilters>(
    () => ({
      ...filters,
      ...(debouncedSearch.trim() !== ""
        ? { search: debouncedSearch.trim() }
        : {}),
    }),
    [filters, debouncedSearch],
  );

  const query = useTransactions(spaceId, effective);
  const accounts = useAccounts(spaceId);
  const categories = useCategories(spaceId);
  const members = useMembers(spaceId);

  const items = useMemo(
    () => query.data?.pages.flatMap((page) => page.items) ?? [],
    [query.data],
  );

  const activeFilterCount = (
    Object.keys(filters) as (keyof TransactionFilters)[]
  ).filter((key) => filters[key] !== undefined).length;

  return (
    <div className="space-y-4 py-3">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
            }}
            placeholder="Buscar"
            aria-label="Buscar movimientos"
            className="min-h-touch pl-9"
            // `search` da la tecla de búsqueda en el teclado de iOS.
            type="search"
            enterKeyHint="search"
          />
        </div>

        <Button
          variant="outline"
          size="icon"
          className="relative min-h-touch min-w-touch shrink-0"
          onClick={() => {
            setShowFilters(true);
          }}
          aria-label="Filtros"
        >
          <SlidersHorizontal className="size-4" />
          {activeFilterCount > 0 && (
            <span className="absolute -top-1 -right-1 flex size-4 items-center justify-center rounded-full bg-primary text-[10px] text-primary-foreground">
              {activeFilterCount}
            </span>
          )}
        </Button>
      </div>

      {activeFilterCount > 0 && (
        <button
          type="button"
          onClick={() => {
            setFilters({});
          }}
          className="flex min-h-touch items-center gap-1 text-xs text-muted-foreground"
        >
          <X className="size-3" />
          Quitar filtros
        </button>
      )}

      <TransactionList
        pages={items}
        locale={session.data?.locale ?? "es-ES"}
        timezone={session.data?.timezone ?? "Europe/Madrid"}
        showAuthors={(space?.memberCount ?? 1) > 1}
        isLoading={query.isLoading}
        hasNextPage={query.hasNextPage}
        isFetchingNextPage={query.isFetchingNextPage}
        onLoadMore={() => {
          void query.fetchNextPage();
        }}
        onSelect={setSelected}
      />

      <TransactionDetail
        transaction={selected}
        spaceId={spaceId}
        locale={session.data?.locale ?? "es-ES"}
        canEdit={space !== undefined && hasAtLeast(space.role, "MEMBER")}
        isShared={(space?.memberCount ?? 1) > 1}
        onClose={() => {
          setSelected(null);
        }}
        onEdit={() => {
          // El detalle se cierra antes de abrir la edición: dos drawers
          // apilados en un teléfono son una trampa para el gesto de volver.
          setEditing(selected);
          setSelected(null);
        }}
      />

      {/* Con `key` por movimiento: sin eso, editar un segundo movimiento
          reusaría el formulario del primero con sus datos viejos. */}
      {editing !== null && (
        <EditTransactionSheet
          key={editing.id}
          open
          onOpenChange={(value) => {
            if (!value) setEditing(null);
          }}
          spaceId={spaceId}
          transaction={editing}
        />
      )}

      <Drawer open={showFilters} onOpenChange={setShowFilters}>
        <DrawerContent className="max-h-[85dvh] pb-safe-bottom">
          <DrawerHeader className="text-left">
            <DrawerTitle>Filtros</DrawerTitle>
          </DrawerHeader>

          <DrawerBody className="space-y-5">
            <FilterGroup label="Tipo">
              {(["EXPENSE", "INCOME"] as const).map((type) => (
                <Chip
                  key={type}
                  active={filters.type?.includes(type) ?? false}
                  onClick={() => {
                    setFilters((prev) => ({
                      ...prev,
                      type: prev.type?.includes(type) ? undefined : [type],
                    }));
                  }}
                >
                  {type === "EXPENSE" ? "Gastos" : "Ingresos"}
                </Chip>
              ))}
            </FilterGroup>

            <FilterGroup label="Estado">
              {(["PENDING", "CLEARED"] as const).map((status) => (
                <Chip
                  key={status}
                  active={filters.status === status}
                  onClick={() => {
                    setFilters((prev) => ({
                      ...prev,
                      status: prev.status === status ? undefined : status,
                    }));
                  }}
                >
                  {status === "PENDING" ? "Pendientes" : "Confirmados"}
                </Chip>
              ))}
            </FilterGroup>

            <FilterGroup label="Cuenta">
              {(accounts.data ?? []).map((account) => (
                <Chip
                  key={account.id}
                  active={filters.accountId?.includes(account.id) ?? false}
                  onClick={() => {
                    setFilters((prev) => ({
                      ...prev,
                      accountId: prev.accountId?.includes(account.id)
                        ? undefined
                        : [account.id],
                    }));
                  }}
                >
                  {account.name}
                </Chip>
              ))}
            </FilterGroup>

            <FilterGroup label="Categoría">
              {(categories.data ?? []).slice(0, 12).map((category) => (
                <Chip
                  key={category.id}
                  active={filters.categoryId?.includes(category.id) ?? false}
                  onClick={() => {
                    setFilters((prev) => ({
                      ...prev,
                      categoryId: prev.categoryId?.includes(category.id)
                        ? undefined
                        : [category.id],
                    }));
                  }}
                >
                  {category.name}
                </Chip>
              ))}
            </FilterGroup>

            {(members.data?.length ?? 0) > 1 && (
              <FilterGroup label="Quién lo cargó">
                {(members.data ?? []).map((member) => (
                  <Chip
                    key={member.userId}
                    active={
                      filters.createdByUserId?.includes(member.userId) ?? false
                    }
                    onClick={() => {
                      setFilters((prev) => ({
                        ...prev,
                        createdByUserId: prev.createdByUserId?.includes(
                          member.userId,
                        )
                          ? undefined
                          : [member.userId],
                      }));
                    }}
                  >
                    {member.name}
                  </Chip>
                ))}
              </FilterGroup>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="from">Desde</Label>
                <Input
                  id="from"
                  type="date"
                  value={filters.from ?? ""}
                  onChange={(e) => {
                    setFilters((prev) => ({
                      ...prev,
                      from: e.target.value === "" ? undefined : e.target.value,
                    }));
                  }}
                  className="min-h-touch"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="to">Hasta</Label>
                <Input
                  id="to"
                  type="date"
                  value={filters.to ?? ""}
                  onChange={(e) => {
                    setFilters((prev) => ({
                      ...prev,
                      to: e.target.value === "" ? undefined : e.target.value,
                    }));
                  }}
                  className="min-h-touch"
                />
              </div>
            </div>

            <Button
              className="min-h-touch w-full"
              onClick={() => {
                setShowFilters(false);
              }}
            >
              Ver resultados
            </Button>
          </DrawerBody>
        </DrawerContent>
      </Drawer>
    </div>
  );
}

/**
 * Detalle de un movimiento.
 *
 * Existe sobre todo para alojar los adjuntos: el listado ya muestra lo demás y
 * una pantalla entera para repetirlo no aportaba nada. El recibo, en cambio,
 * necesita un sitio donde vivir.
 */
function TransactionDetail({
  transaction,
  spaceId,
  locale,
  canEdit,
  isShared,
  onClose,
  onEdit,
}: {
  transaction: TransactionDTO | null;
  spaceId: string;
  locale: string;
  canEdit: boolean;
  isShared: boolean;
  onClose: () => void;
  onEdit: () => void;
}) {
  const update = useUpdateTransaction(spaceId);

  return (
    <Drawer
      open={transaction !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DrawerContent className="max-h-[85dvh] pb-safe-bottom">
        <DrawerHeader className="text-left">
          <DrawerTitle>
            {transaction?.description ??
              transaction?.category?.name ??
              "Movimiento"}
          </DrawerTitle>
        </DrawerHeader>

        {transaction !== null && (
          <DrawerBody className="space-y-5">
            <div className="flex items-baseline justify-between">
              <span
                className={cn(
                  "text-2xl font-semibold tabular-nums",
                  transaction.type === "INCOME" && "text-income",
                )}
              >
                {formatSignedAmount(
                  transaction.amount,
                  transaction.type,
                  locale,
                  transaction.transferDirection,
                )}
              </span>
              <span className="text-xs text-muted-foreground">
                {formatCalendarDate(transaction.date, locale, {
                  dateStyle: "long",
                })}
              </span>
            </div>

            <dl className="space-y-1.5 text-sm">
              <Detail label="Cuenta" value={transaction.account.name} />
              {transaction.category !== null && (
                <Detail label="Categoría" value={transaction.category.name} />
              )}
              {transaction.payee !== null && (
                <Detail label="Beneficiario" value={transaction.payee} />
              )}
              <Detail label="Cargado por" value={transaction.author.name} />
              {transaction.notes !== null && (
                <Detail label="Notas" value={transaction.notes} />
              )}
              {/* Solo se dice cuando hay algo que hacer: "confirmado" es el
                  estado normal de todo movimiento y decirlo sería ruido. */}
              {transaction.status === "PENDING" && (
                <Detail label="Estado" value="Pendiente de confirmar" />
              )}
            </dl>

            {/* Las patas de una transferencia no se editan sueltas: cambiarle
                el importe a una descuadraría la otra. Se dice en vez de
                esconder el botón y que parezca un olvido. */}
            {canEdit &&
              (transaction.transferGroupId === null ? (
                <Button
                  variant="outline"
                  className="min-h-touch w-full"
                  onClick={onEdit}
                >
                  <Pencil className="size-4" />
                  Editar movimiento
                </Button>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Esto es una pata de una transferencia y no se edita suelta:
                  cambiarla descuadraría la otra cuenta.
                </p>
              ))}

            {transaction.status === "PENDING" && canEdit && (
              <Button
                className="w-full"
                disabled={update.isPending}
                onClick={() => {
                  update.mutate(
                    { id: transaction.id, status: "CLEARED" },
                    {
                      onSuccess: () => {
                        toast.success("Movimiento confirmado");
                        // El drawer muestra la copia que le pasó la lista; se
                        // cierra para no dejar en pantalla un "pendiente" que
                        // ya no es cierto mientras refetchea.
                        onClose();
                      },
                    },
                  );
                }}
              >
                <Check className="size-4" />
                {update.isPending ? "Confirmando…" : "Confirmar movimiento"}
              </Button>
            )}

            {/* Solo en Spaces compartidos: repartir un gasto con uno mismo no
                significa nada. */}
            {isShared && transaction.type === "EXPENSE" && (
              <SplitPanel
                spaceId={spaceId}
                transactionId={transaction.id}
                locale={locale}
                canEdit={canEdit}
              />
            )}

            <AttachmentsPanel
              spaceId={spaceId}
              transactionId={transaction.id}
              locale={locale}
              canEdit={canEdit}
            />
          </DrawerBody>
        )}
      </DrawerContent>
    </Drawer>
  );
}

/**
 * Editar un movimiento.
 *
 * Se edita lo que puede haber salido mal al cargarlo: importe, fecha, cuenta,
 * categoría y los textos. El tipo y la moneda no —cambiarlos invalidaría el
 * signo y la conversión congelada de algo ya contabilizado—, y las
 * transferencias no llegan hasta acá (el detalle ni ofrece el botón).
 *
 * Manda siempre el formulario completo, no un diff: los campos de texto
 * vacíos van como `null` para poder BORRAR una descripción o una nota, que es
 * la mitad de para qué sirve editar.
 */
function EditTransactionSheet({
  open,
  onOpenChange,
  spaceId,
  transaction,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  spaceId: string;
  transaction: TransactionDTO;
}) {
  const kind = transaction.type === "INCOME" ? "INCOME" : "EXPENSE";
  const accounts = useAccounts(spaceId);
  const categories = useCategories(spaceId, kind);
  const update = useUpdateTransaction(spaceId);
  const exponent = getCurrencyExponent(transaction.amount.currency);

  const [amount, setAmount] = useState(
    minorToInput(transaction.amount.amountMinor, exponent),
  );
  const [date, setDate] = useState(transaction.date);
  const [description, setDescription] = useState(transaction.description ?? "");
  const [payee, setPayee] = useState(transaction.payee ?? "");
  const [notes, setNotes] = useState(transaction.notes ?? "");
  const [categoryId, setCategoryId] = useState<string | null>(
    transaction.category?.id ?? null,
  );
  const [accountId, setAccountId] = useState(transaction.account.id);

  /**
   * Solo cuentas de la misma moneda: la moneda del movimiento no se edita, y
   * moverlo a una cuenta que opera en otra lo dejaría descuadrado ahí.
   */
  const active = accounts.data?.filter((a) => !a.isArchived) ?? [];
  const eligible = active.filter(
    (a) => a.currency === transaction.amount.currency,
  );

  const canSave =
    isAmountInput(amount) &&
    Number(amount.replace(",", ".")) > 0 &&
    date !== "" &&
    !update.isPending;

  const submit = (): void => {
    update.mutate(
      {
        id: transaction.id,
        accountId,
        categoryId,
        amountMinor: toMinor(amount, exponent),
        date,
        description: description.trim() === "" ? null : description.trim(),
        payee: payee.trim() === "" ? null : payee.trim(),
        notes: notes.trim() === "" ? null : notes.trim(),
      },
      {
        onSuccess: () => {
          toast.success("Movimiento actualizado");
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
      <DrawerContent className="max-h-[90dvh] pb-safe-bottom">
        <DrawerHeader className="text-left">
          <DrawerTitle>
            Editar {kind === "EXPENSE" ? "gasto" : "ingreso"}
          </DrawerTitle>
        </DrawerHeader>

        <DrawerBody className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="edit-tx-amount">
                Importe ({transaction.amount.currency})
              </Label>
              <Input
                id="edit-tx-amount"
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value);
                }}
                inputMode="decimal"
                className="min-h-touch"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-tx-date">Fecha</Label>
              <Input
                id="edit-tx-date"
                type="date"
                value={date}
                onChange={(e) => {
                  setDate(e.target.value);
                }}
                className="min-h-touch"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Categoría</Label>
            {categories.data === undefined ? (
              <div className="grid grid-cols-4 gap-2">
                {Array.from({ length: 8 }, (_unused, i) => (
                  <Skeleton key={i} className="h-20 rounded-xl" />
                ))}
              </div>
            ) : (
              <CategoryGrid
                categories={categories.data}
                selectedId={categoryId}
                onSelect={(category) => {
                  setCategoryId(category?.id ?? null);
                }}
              />
            )}
          </div>

          <div className="space-y-2">
            <Label>Cuenta</Label>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {eligible.map((account) => (
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
            {eligible.length < active.length && (
              <p className="text-xs text-muted-foreground">
                Solo se muestran cuentas en {transaction.amount.currency}: la
                moneda de un movimiento ya cargado no se cambia.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="edit-tx-description">Descripción</Label>
            <Input
              id="edit-tx-description"
              value={description}
              onChange={(e) => {
                setDescription(e.target.value);
              }}
              placeholder="Opcional"
              className="min-h-touch"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="edit-tx-payee">Beneficiario</Label>
            <Input
              id="edit-tx-payee"
              value={payee}
              onChange={(e) => {
                setPayee(e.target.value);
              }}
              placeholder="Opcional"
              className="min-h-touch"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="edit-tx-notes">Notas</Label>
            <Input
              id="edit-tx-notes"
              value={notes}
              onChange={(e) => {
                setNotes(e.target.value);
              }}
              placeholder="Opcional"
              className="min-h-touch"
            />
          </div>

          <Button
            className="min-h-touch w-full"
            disabled={!canSave}
            onClick={submit}
          >
            {update.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              "Guardar cambios"
            )}
          </Button>
        </DrawerBody>
      </DrawerContent>
    </Drawer>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate text-right">{value}</dd>
    </div>
  );
}

function FilterGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </p>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
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
