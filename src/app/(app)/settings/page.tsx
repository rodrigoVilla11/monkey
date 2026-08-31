"use client";

import {
  ArrowLeftRight,
  CalendarClock,
  ChartColumn,
  ChevronRight,
  Coins,
  HandCoins,
  LogOut,
  Moon,
  PiggyBank,
  Scale,
  Shapes,
  ShieldCheck,
  Sun,
  Target,
  Upload,
  Users,
} from "lucide-react";
import { useTheme } from "next-themes";
import Link from "next/link";
import { toast } from "sonner";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ApiError } from "@/lib/api-client";
import { initials } from "@/lib/format";
import {
  useActiveSpace,
  useLogout,
  useSession,
  useUpdateProfile,
} from "@/lib/hooks/use-session";
import { cn } from "@/lib/utils";
import { SUGGESTED_CURRENCIES } from "@/shared/currency";
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
  const updateProfile = useUpdateProfile();

  /**
   * La preferida va primera aunque no esté entre las sugeridas (se puede haber
   * elegido cualquier código ISO por la API): si no, la pantalla mostraría
   * once monedas y ninguna marcada.
   */
  const preferred = user?.preferredCurrency;
  const currencyOptions: readonly string[] =
    preferred === undefined ||
    SUGGESTED_CURRENCIES.some((option) => option === preferred)
      ? SUGGESTED_CURRENCIES
      : [preferred, ...SUGGESTED_CURRENCIES];

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
              href="/settings/categories"
              icon={<Shapes className="size-4" />}
              label="Categorías"
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
            {/* Solo tiene sentido con más de una persona. */}
            {space.memberCount > 1 && (
              <Row
                href="/balances"
                icon={<Scale className="size-4" />}
                label="Cuentas entre nosotros"
              />
            )}
            <Row
              href="/reports"
              icon={<ChartColumn className="size-4" />}
              label="Reportes"
            />
            <Row
              href="/settings/rates"
              icon={<ArrowLeftRight className="size-4" />}
              label="Cotizaciones"
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
          <Row
            href="/settings/data"
            icon={<Upload className="size-4" />}
            label="Importar y exportar"
          />

          <div className="space-y-2 px-4 py-3">
            <span className="flex min-h-touch items-center gap-3 text-sm">
              <Coins className="size-4" />
              Moneda principal
            </span>
            <div className="flex flex-wrap gap-2">
              {currencyOptions.map((option) => (
                <button
                  key={option}
                  type="button"
                  disabled={updateProfile.isPending}
                  aria-pressed={preferred === option}
                  onClick={() => {
                    if (option === preferred) return;
                    updateProfile.mutate(
                      { preferredCurrency: option },
                      {
                        onSuccess: () => {
                          toast.success(`Moneda principal: ${option}`);
                        },
                        onError: (error: unknown) => {
                          toast.error(
                            error instanceof ApiError
                              ? error.message
                              : "No se pudo guardar",
                          );
                        },
                      },
                    );
                  }}
                  className={cn(
                    "min-h-touch rounded-full border px-3 text-sm tabular-nums",
                    preferred === option &&
                      "border-primary bg-primary text-primary-foreground",
                  )}
                >
                  {option}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Es la que se propone al crear espacios, cuentas y deudas. No
              cambia la moneda de los espacios que ya existen ni de los
              movimientos ya cargados.
            </p>
          </div>

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
