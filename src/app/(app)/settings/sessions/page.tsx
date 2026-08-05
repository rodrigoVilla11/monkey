"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, Loader2, Smartphone } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api-client";
import { queryKeys } from "@/lib/query-keys";
import { useLogout } from "@/lib/hooks/use-session";
import { useSession } from "@/lib/hooks/use-session";
import type { ActiveSession } from "@/shared/contracts/auth";
import { formatInstant } from "@/shared/dates";

/**
 * Sesiones activas.
 *
 * "Cerrar todas" cierra también esta, y por eso redirige al login. Es
 * intencional: quien usa este botón sospecha que alguien entró, y dejarse a
 * uno mismo dentro sería incoherente.
 */
export default function SessionsPage() {
  const queryClient = useQueryClient();
  const session = useSession();
  const logout = useLogout();

  const sessions = useQuery({
    queryKey: queryKeys.sessions,
    queryFn: () => api.get<{ sessions: ActiveSession[] }>("/auth/sessions"),
    select: (data) => data.sessions,
  });

  const revoke = useMutation({
    mutationFn: (id: string) => api.delete(`/auth/sessions/${id}`),
    onSuccess: async () => {
      toast.success("Sesión cerrada");
      await queryClient.invalidateQueries({ queryKey: queryKeys.sessions });
    },
  });

  const revokeAll = useMutation({
    mutationFn: () => api.post("/auth/sessions/revoke-all"),
    onSuccess: () => {
      logout.mutate();
    },
  });

  const locale = session.data?.locale ?? "es-ES";
  const timezone = session.data?.timezone ?? "Europe/Madrid";

  return (
    <div className="space-y-4 py-3">
      <Link
        href="/settings"
        className="flex min-h-touch items-center gap-1 text-sm text-muted-foreground"
      >
        <ChevronLeft className="size-4" />
        Ajustes
      </Link>

      <div>
        <h1 className="text-xl font-semibold">Sesiones activas</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Dispositivos donde tu cuenta está abierta.
        </p>
      </div>

      {sessions.data === undefined ? (
        <div className="space-y-3">
          {Array.from({ length: 2 }, (_unused, i) => (
            <Skeleton key={i} className="h-20 w-full rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          {sessions.data.map((item) => (
            <Card key={item.id} className="flex-row items-center gap-3 p-4">
              <Smartphone className="size-5 shrink-0 text-muted-foreground" />

              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 text-sm font-medium">
                  {item.deviceLabel ?? "Dispositivo"}
                  {item.current && (
                    <span className="rounded-full bg-income/15 px-2 py-0.5 text-[10px] text-income">
                      este
                    </span>
                  )}
                </p>
                <p className="text-xs text-muted-foreground">
                  {item.lastUsedAt !== null
                    ? `Última vez: ${formatInstant(new Date(item.lastUsedAt), timezone, locale)}`
                    : `Iniciada: ${formatInstant(new Date(item.createdAt), timezone, locale)}`}
                </p>
              </div>

              {!item.current && (
                <button
                  type="button"
                  onClick={() => {
                    revoke.mutate(item.id);
                  }}
                  className="min-h-touch text-xs text-destructive underline underline-offset-4"
                >
                  Cerrar
                </button>
              )}
            </Card>
          ))}
        </div>
      )}

      <Button
        variant="outline"
        className="min-h-touch w-full text-destructive"
        disabled={revokeAll.isPending}
        onClick={() => {
          revokeAll.mutate();
        }}
      >
        {revokeAll.isPending ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          "Cerrar sesión en todos los dispositivos"
        )}
      </Button>

      <p className="text-xs text-muted-foreground">
        Incluye este dispositivo: vas a tener que entrar de nuevo.
      </p>
    </div>
  );
}
