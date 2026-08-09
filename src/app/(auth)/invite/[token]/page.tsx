"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { CheckCircle2, Loader2, Users } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { ApiError, api } from "@/lib/api-client";
import { useSession } from "@/lib/hooks/use-session";
import { ROLE_DESCRIPTIONS, ROLE_LABELS } from "@/shared/roles";
import type { InvitationPreview } from "@/shared/contracts/spaces";

/**
 * Pantalla de invitación.
 *
 * La vista previa NO necesita sesión: quien recibe el enlace puede no tener
 * cuenta todavía. Muestra a qué Space lo invitan y con qué rol, y desde ahí
 * ramifica según el estado:
 *
 *  · sin cuenta   → a registrarse, y al volver acepta
 *  · logueado con OTRO email → se lo dice claro, en vez de un 403 seco
 *  · logueado con el email correcto → un botón y adentro
 */
export default function InvitePage() {
  const token = String(useParams().token ?? "");
  const router = useRouter();
  const session = useSession();

  const preview = useQuery({
    queryKey: ["invitation", token],
    queryFn: () =>
      api.get<{ invitation: InvitationPreview }>(`/invitations/${token}`),
    select: (data) => data.invitation,
    retry: false,
  });

  const accept = useMutation({
    mutationFn: () => api.post(`/invitations/${token}/accept`),
    onSuccess: () => {
      router.replace("/");
    },
  });

  if (preview.isLoading) {
    return <Loader2 className="mx-auto size-6 animate-spin" />;
  }

  // `isError` no estrecha `data` a definido: se comprueba el dato en sí.
  if (preview.isError || preview.data === undefined) {
    return (
      <div className="flex flex-col items-center gap-4 text-center">
        <h2 className="text-lg font-semibold">Invitación no válida</h2>
        <p className="text-sm text-muted-foreground">
          {preview.error instanceof ApiError
            ? preview.error.message
            : "El enlace no sirve o ya se usó"}
        </p>
        <Button asChild variant="outline" className="min-h-touch w-full">
          <Link href="/">Ir a monKey</Link>
        </Button>
      </div>
    );
  }

  const invitation = preview.data;
  const sessionEmail = session.data?.email;
  const isLoggedIn = sessionEmail !== undefined;
  const emailMatches = sessionEmail === invitation.email;

  return (
    <div className="flex flex-col items-center gap-5 text-center">
      <Users className="size-12 text-muted-foreground" />

      <div>
        <h2 className="text-lg font-semibold">
          Te invitaron a {invitation.spaceName}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {invitation.invitedByName ?? "Alguien"} te invitó a compartir este
          espacio como{" "}
          <span className="font-medium text-foreground">
            {ROLE_LABELS[invitation.role].toLowerCase()}
          </span>
          .
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          {ROLE_DESCRIPTIONS[invitation.role]}
        </p>
      </div>

      {!isLoggedIn && (
        <div className="w-full space-y-2">
          <p className="text-sm text-muted-foreground">
            La invitación es para {invitation.email}. Creá tu cuenta con ese
            email y volvé a este enlace.
          </p>
          <Button asChild className="min-h-touch w-full">
            <Link
              href={`/register?email=${encodeURIComponent(invitation.email)}`}
            >
              Crear cuenta
            </Link>
          </Button>
          <Button asChild variant="outline" className="min-h-touch w-full">
            <Link href="/login">Ya tengo cuenta</Link>
          </Button>
        </div>
      )}

      {isLoggedIn && !emailMatches && (
        <div className="w-full space-y-2">
          <p className="text-sm text-destructive">
            Esta invitación es para {invitation.email}, pero entraste como{" "}
            {sessionEmail}.
          </p>
          <Button asChild variant="outline" className="min-h-touch w-full">
            <Link href="/login">Entrar con otra cuenta</Link>
          </Button>
        </div>
      )}

      {isLoggedIn && emailMatches && (
        <div className="w-full space-y-2">
          {accept.isError && (
            <p role="alert" className="text-sm text-destructive">
              {accept.error instanceof ApiError
                ? accept.error.message
                : "No se pudo aceptar"}
            </p>
          )}
          <Button
            className="min-h-touch w-full"
            disabled={accept.isPending}
            onClick={() => {
              accept.mutate();
            }}
          >
            {accept.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <>
                <CheckCircle2 className="size-4" />
                Unirme a {invitation.spaceName}
              </>
            )}
          </Button>
        </div>
      )}
    </div>
  );
}
