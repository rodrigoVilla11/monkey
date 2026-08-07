"use client";

import {
  CalendarClock,
  ChartColumn,
  ChevronRight,
  HandCoins,
  LogOut,
  Moon,
  PiggyBank,
  ShieldCheck,
  Sun,
  Target,
  Users,
} from "lucide-react";
import { useTheme } from "next-themes";
import Link from "next/link";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { initials } from "@/lib/format";
import { useActiveSpace, useLogout, useSession } from "@/lib/hooks/use-session";
import { cn } from "@/lib/utils";
import { ROLE_LABELS } from "@/shared/roles";

export default function SettingsPage() {
  const session = useSession();
  const { space } = useActiveSpace();
  const logout = useLogout();
  /**
   * `resolvedTheme` viene undefined hasta que next-themes lee la preferencia
   * en el cliente. Se usa eso como señal de "ya montó" en vez de un
   * useState + useEffect: el efecto solo para marcar un booleano provoca un
   * render extra y el linter de React lo señala con razón.
   */
  const { theme, resolvedTheme, setTheme } = useTheme();
  const mounted = resolvedTheme !== undefined;

  const user = session.data;

  return (
    <div className="space-y-5 py-3">
      <h1 className="text-xl font-semibold">Ajustes</h1>

      <Card className="flex-row items-center gap-3 p-4">
        <Avatar className="size-12">
          {user?.avatarUrl != null && (
            <AvatarImage src={user.avatarUrl} alt="" />
          )}
          <AvatarFallback>{initials(user?.name ?? "?")}</AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <p className="truncate font-medium">{user?.name}</p>
          <p className="truncate text-sm text-muted-foreground">
            {user?.email}
          </p>
        </div>
      </Card>

      {space !== undefined && (
        <section className="space-y-2">
          <h2 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {space.name}
          </h2>
          <Card className="divide-y p-0">
            <Row
              href="/settings/members"
              icon={<Users className="size-4" />}
              label="Miembros"
              value={`${String(space.memberCount)} · sos ${ROLE_LABELS[space.role].toLowerCase()}`}
            />
            {/* Los programados no van en la barra inferior: se configuran una
                vez y después se miran poco. */}
            <Row
              href="/recurring"
              icon={<CalendarClock className="size-4" />}
              label="Movimientos programados"
            />
            <Row
              href="/budgets"
              icon={<PiggyBank className="size-4" />}
              label="Presupuestos"
            />
            <Row
              href="/goals"
              icon={<Target className="size-4" />}
              label="Metas de ahorro"
            />
            <Row
              href="/debts"
              icon={<HandCoins className="size-4" />}
              label="Deudas y préstamos"
            />
            <Row
              href="/reports"
              icon={<ChartColumn className="size-4" />}
              label="Reportes"
            />
          </Card>
        </section>
      )}

      <section className="space-y-2">
        <h2 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Cuenta
        </h2>
        <Card className="divide-y p-0">
          <Row
            href="/settings/sessions"
            icon={<ShieldCheck className="size-4" />}
            label="Sesiones activas"
          />

          <div className="flex min-h-touch items-center justify-between px-4 py-3">
            <span className="flex items-center gap-3 text-sm">
              {mounted && theme === "dark" ? (
                <Moon className="size-4" />
              ) : (
                <Sun className="size-4" />
              )}
              Tema
            </span>

            <div className="flex rounded-full bg-secondary p-0.5">
              {(["light", "dark", "system"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => {
                    setTheme(option);
                  }}
                  className={cn(
                    "rounded-full px-3 py-1.5 text-xs",
                    mounted && theme === option && "bg-background shadow-sm",
                  )}
                >
                  {option === "light"
                    ? "Claro"
                    : option === "dark"
                      ? "Oscuro"
                      : "Auto"}
                </button>
              ))}
            </div>
          </div>
        </Card>
      </section>

      <Button
        variant="outline"
        className="min-h-touch w-full text-destructive"
        onClick={() => {
          logout.mutate();
        }}
      >
        <LogOut className="size-4" />
        Cerrar sesión
      </Button>

      <p className="text-center text-xs text-muted-foreground">
        {user?.locale} · {user?.timezone}
      </p>
    </div>
  );
}

function Row({
  href,
  icon,
  label,
  value,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  value?: string;
}) {
  return (
    <Link
      href={href}
      className="flex min-h-touch items-center justify-between px-4 py-3 active:opacity-70"
    >
      <span className="flex items-center gap-3 text-sm">
        {icon}
        {label}
      </span>
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        {value}
        <ChevronRight className="size-4" />
      </span>
    </Link>
  );
}
