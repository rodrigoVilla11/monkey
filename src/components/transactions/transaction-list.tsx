"use client";

import { ArrowLeftRight, Loader2, Receipt } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { DynamicIcon } from "@/components/ui/dynamic-icon";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDayHeading, formatSignedAmount, initials } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { TransactionDTO } from "@/shared/contracts/transactions";

/**
 * Listado de movimientos agrupado por día, con scroll infinito.
 *
 * El agrupado se hace en el cliente y no en el servidor porque "qué día es
 * cada movimiento" ya viene resuelto (es un CalendarDate) y porque "Hoy" y
 * "Ayer" dependen de la timezone de quien mira.
 *
 * La página siguiente se pide con un IntersectionObserver sobre un centinela
 * al final: sin listeners de scroll, sin recalcular posiciones, y el navegador
 * decide cuándo conviene.
 */
export function TransactionList({
  pages,
  locale,
  timezone,
  showAuthors,
  isLoading,
  hasNextPage,
  isFetchingNextPage,
  onLoadMore,
  onSelect,
}: {
  pages: readonly TransactionDTO[];
  locale: string;
  timezone: string;
  /** Solo en Spaces compartidos: en uno personal el avatar sería siempre el mismo. */
  showAuthors: boolean;
  isLoading: boolean;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  onLoadMore: () => void;
  onSelect?: (transaction: TransactionDTO) => void;
}) {
  const sentinel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = sentinel.current;
    if (node === null || !hasNextPage) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting === true && !isFetchingNextPage) {
          onLoadMore();
        }
      },
      // 300px de margen: la página siguiente empieza a cargar antes de que el
      // centinela sea visible, así el scroll no se corta.
      { rootMargin: "300px" },
    );

    observer.observe(node);
    return () => {
      observer.disconnect();
    };
  }, [hasNextPage, isFetchingNextPage, onLoadMore]);

  const groups = useMemo(() => groupByDay(pages), [pages]);

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 6 }, (_unused, i) => (
          <Skeleton key={i} className="h-16 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  if (pages.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-16 text-center text-muted-foreground">
        <Receipt className="size-10 opacity-40" />
        <p className="text-sm">No hay movimientos que coincidan</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {groups.map(([day, items]) => (
        <section key={day}>
          <h3 className="sticky top-0 z-10 bg-background/85 py-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase backdrop-blur">
            {formatDayHeading(day, locale, timezone)}
          </h3>

          <ul className="divide-y">
            {items.map((transaction) => (
              <li key={transaction.id}>
                <TransactionRow
                  transaction={transaction}
                  locale={locale}
                  showAuthor={showAuthors}
                  {...(onSelect !== undefined ? { onSelect } : {})}
                />
              </li>
            ))}
          </ul>
        </section>
      ))}

      <div ref={sentinel} className="h-px" aria-hidden />

      {isFetchingNextPage && (
        <div className="flex justify-center py-4">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      )}
    </div>
  );
}

function TransactionRow({
  transaction,
  locale,
  showAuthor,
  onSelect,
}: {
  transaction: TransactionDTO;
  locale: string;
  showAuthor: boolean;
  onSelect?: (transaction: TransactionDTO) => void;
}) {
  const isTransfer = transaction.type === "TRANSFER";
  const color = isTransfer
    ? "#71717a"
    : (transaction.category?.color ?? "#71717a");

  /**
   * En una transferencia el título es el recorrido, no la categoría: una
   * transferencia no tiene, y "Sin descripción" no le dice nada a nadie.
   * La contraparte viene resuelta desde el servidor.
   */
  const counterpart = transaction.transferCounterpartAccount?.name;
  const title = isTransfer
    ? (transaction.description ??
      (counterpart === undefined
        ? "Transferencia"
        : transaction.transferDirection === "OUT"
          ? `Hacia ${counterpart}`
          : `Desde ${counterpart}`))
    : (transaction.description ??
      transaction.payee ??
      transaction.category?.name ??
      "Sin descripción");

  return (
    <button
      type="button"
      onClick={() => {
        onSelect?.(transaction);
      }}
      className="flex min-h-touch w-full items-center gap-3 py-3 text-left active:opacity-70"
    >
      <span
        className="flex size-10 shrink-0 items-center justify-center rounded-full"
        style={{ backgroundColor: `${color}26` }}
      >
        {isTransfer ? (
          <ArrowLeftRight className="size-4.5" style={{ color }} />
        ) : (
          <DynamicIcon
            name={transaction.category?.icon}
            className="size-4.5"
            style={{ color }}
          />
        )}
      </span>

      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{title}</span>
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {showAuthor && (
            <Avatar className="size-4" title={transaction.author.name}>
              {transaction.author.avatarUrl !== null && (
                <AvatarImage src={transaction.author.avatarUrl} alt="" />
              )}
              <AvatarFallback className="text-[8px]">
                {initials(transaction.author.name)}
              </AvatarFallback>
            </Avatar>
          )}
          <span className="truncate">{transaction.account.name}</span>
          {transaction.status === "PENDING" && (
            <span className="text-[10px] uppercase">· pendiente</span>
          )}
        </span>
      </span>

      <span
        className={cn(
          "shrink-0 text-sm font-semibold tabular-nums",
          transaction.type === "INCOME" && "text-income",
          // La transferencia va en gris: no es ni ingreso ni gasto, y pintarla
          // de verde la haría parecer plata que entró de afuera.
          isTransfer && "font-medium text-muted-foreground",
        )}
      >
        {formatSignedAmount(
          transaction.amount,
          transaction.type,
          locale,
          transaction.transferDirection,
        )}
      </span>
    </button>
  );
}

/** Agrupa preservando el orden que vino del servidor (fecha descendente). */
const groupByDay = (
  transactions: readonly TransactionDTO[],
): [string, TransactionDTO[]][] => {
  const groups = new Map<string, TransactionDTO[]>();

  for (const transaction of transactions) {
    const bucket = groups.get(transaction.date) ?? [];
    bucket.push(transaction);
    groups.set(transaction.date, bucket);
  }

  return [...groups.entries()];
};
