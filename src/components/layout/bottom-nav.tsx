"use client";

import { ArrowLeftRight, ChartPie, Plus, Settings, Wallet } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

/**
 * Navegación inferior: 4 destinos + FAB central.
 *
 * Detalles que la hacen sentir nativa en un iPhone:
 *  · `pb-safe-bottom` para no quedar debajo del indicador de inicio
 *  · targets de 44×44 como mínimo (Apple HIG)
 *  · `position: fixed` con el contenido scrolleando por debajo
 */

const DESTINATIONS = [
  { href: "/", label: "Resumen", icon: ChartPie },
  { href: "/transactions", label: "Movimientos", icon: ArrowLeftRight },
  { href: "/accounts", label: "Cuentas", icon: Wallet },
  { href: "/settings", label: "Ajustes", icon: Settings },
] as const;

export function BottomNav() {
  const pathname = usePathname();

  const isActive = (href: string): boolean =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <nav
      className={cn(
        "fixed inset-x-0 bottom-0 z-40 border-t bg-background/85 backdrop-blur-lg",
        "pb-safe-bottom",
      )}
      aria-label="Navegación principal"
    >
      <div className="mx-auto grid h-[var(--spacing-bottom-nav)] max-w-lg grid-cols-5 items-center">
        {DESTINATIONS.slice(0, 2).map((item) => (
          <NavLink key={item.href} {...item} active={isActive(item.href)} />
        ))}

        {/* El FAB ocupa la columna del medio y sobresale hacia arriba. */}
        <div className="relative flex justify-center">
          <Link
            href="/transactions/new"
            aria-label="Agregar movimiento"
            className={cn(
              "absolute -top-7 bg-primary text-primary-foreground",
              "flex size-14 items-center justify-center rounded-full shadow-lg",
              "active:scale-95 motion-safe:transition-transform",
            )}
          >
            <Plus className="size-7" strokeWidth={2.5} />
          </Link>
        </div>

        {DESTINATIONS.slice(2).map((item) => (
          <NavLink key={item.href} {...item} active={isActive(item.href)} />
        ))}
      </div>
    </nav>
  );
}

function NavLink({
  href,
  label,
  icon: Icon,
  active,
}: {
  href: string;
  label: string;
  icon: typeof ChartPie;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-full min-h-touch flex-col items-center justify-center gap-1",
        "text-[11px] font-medium",
        active ? "text-foreground" : "text-muted-foreground",
      )}
    >
      <Icon className="size-5" strokeWidth={active ? 2.4 : 1.9} />
      {label}
    </Link>
  );
}
