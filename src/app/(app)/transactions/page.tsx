"use client";

import { Search, SlidersHorizontal, X } from "lucide-react";
import { useMemo, useState } from "react";

import { AttachmentsPanel } from "@/components/transactions/attachments-panel";
import { SplitPanel } from "@/components/transactions/split-panel";
import { TransactionList } from "@/components/transactions/transaction-list";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  useAccounts,
  useCategories,
  useMembers,
  useTransactions,
} from "@/lib/hooks/use-domain";
import { useActiveSpace, useSession } from "@/lib/hooks/use-session";
import { useDebounced } from "@/lib/hooks/use-debounced";
import { cn } from "@/lib/utils";
import { formatSignedAmount } from "@/lib/format";
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
      />

      <Drawer open={showFilters} onOpenChange={setShowFilters}>
        <DrawerContent className="max-h-[85dvh] pb-safe-bottom">
          <DrawerHeader className="text-left">
            <DrawerTitle>Filtros</DrawerTitle>
          </DrawerHeader>

          <div className="app-scroll space-y-5 px-4 pb-6">
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
          </div>
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
}: {
  transaction: TransactionDTO | null;
  spaceId: string;
  locale: string;
  canEdit: boolean;
  isShared: boolean;
  onClose: () => void;
}) {
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
          <div className="app-scroll space-y-5 px-4 pb-6">
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
            </dl>

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
          </div>
        )}
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
