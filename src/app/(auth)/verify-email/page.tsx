"use client";

import { useMutation } from "@tanstack/react-query";
import { CheckCircle2, Loader2, MailCheck } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ApiError, api } from "@/lib/api-client";
import { useLogout, useSession } from "@/lib/hooks/use-session";

/**
 * Verificación de email. Cumple dos funciones en una pantalla:
 *
 *  · con `?token=` en la URL, verifica y manda a la app
 *  · sin token, es la pantalla de "revisá tu correo" con botón de reenvío
 *
 * No exige sesión para verificar: el enlace se abre en cualquier navegador, y
 * en iOS un PWA instalado tiene cookie jar separado de Safari. Pedir sesión
 * acá fallaría justo en el caso más común.
 */
export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<Loader2 className="mx-auto size-6 animate-spin" />}>
      <VerifyEmailContent />
    </Suspense>
  );
}

function VerifyEmailContent() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get("token");
  const session = useSession();
  const logout = useLogout();

  const verify = useMutation({
    mutationFn: (value: string) =>
      api.post("/auth/verify-email", { token: value }),
  });

  const resend = useMutation({
    mutationFn: () => api.post("/auth/verify-email/resend"),
    onSuccess: () => {
      toast.success("Te mandamos un mail nuevo");
    },
    onError: () => {
      toast.error("No se pudo reenviar. Probá en un rato");
    },
  });

  useEffect(() => {
    if (token !== null && verify.isIdle) verify.mutate(token);
  }, [token, verify]);

  if (token !== null) {
    if (verify.isPending) {
      return (
        <div className="flex flex-col items-center gap-3 text-center">
          <Loader2 className="size-6 animate-spin" />
          <p className="text-sm text-muted-foreground">Verificando tu email…</p>
        </div>
      );
    }

    if (verify.isSuccess) {
      return (
        <div className="flex flex-col items-center gap-4 text-center">
          <CheckCircle2 className="size-12 text-income" />
          <div>
            <h2 className="text-lg font-semibold">Email verificado</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Ya podés usar Monkey.
            </p>
          </div>
          {/* Si el enlace se abrió en Safari y la app está instalada como PWA,
              la sesión vive en otro cookie jar. Por eso se ofrece el enlace en
              vez de redirigir a ciegas. */}
          <Button
            className="min-h-touch w-full"
            onClick={() => {
              router.replace("/");
            }}
          >
            Ir a la app
          </Button>
          <p className="text-xs text-muted-foreground">
            Si abriste este enlace desde el correo, volvé a Monkey desde tu
            pantalla de inicio.
          </p>
        </div>
      );
    }

    return (
      <div className="flex flex-col items-center gap-4 text-center">
        <h2 className="text-lg font-semibold">No pudimos verificar</h2>
        <p className="text-sm text-muted-foreground">
          {verify.error instanceof ApiError
            ? verify.error.message
            : "El enlace no es válido"}
        </p>
        <Button asChild variant="outline" className="min-h-touch w-full">
          <Link href="/login">Volver a entrar</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <MailCheck className="size-12 text-muted-foreground" />
      <div>
        <h2 className="text-lg font-semibold">Revisá tu correo</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Te mandamos un enlace a{" "}
          <span className="text-foreground">
            {session.data?.email ?? "tu email"}
          </span>
          . Vence en 24 horas.
        </p>
      </div>

      <Button
        variant="outline"
        className="min-h-touch w-full"
        disabled={resend.isPending}
        onClick={() => {
          resend.mutate();
        }}
      >
        {resend.isPending ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          "Reenviar el correo"
        )}
      </Button>

      <button
        type="button"
        onClick={() => {
          logout.mutate();
        }}
        className="min-h-touch text-sm text-muted-foreground underline underline-offset-4"
      >
        Salir
      </button>
    </div>
  );
}
