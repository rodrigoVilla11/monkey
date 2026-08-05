"use client";

import { useMutation } from "@tanstack/react-query";
import { CheckCircle2, Loader2 } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError, api } from "@/lib/api-client";

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<Loader2 className="mx-auto size-6 animate-spin" />}>
      <ResetPasswordContent />
    </Suspense>
  );
}

function ResetPasswordContent() {
  const token = useSearchParams().get("token") ?? "";
  const [password, setPassword] = useState("");

  const reset = useMutation({
    mutationFn: () => api.post("/auth/password/reset", { token, password }),
  });

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    reset.mutate();
  };

  if (reset.isSuccess) {
    return (
      <div className="flex flex-col items-center gap-4 text-center">
        <CheckCircle2 className="size-12 text-income" />
        <div>
          <h2 className="text-lg font-semibold">Contraseña cambiada</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Se cerraron todas las sesiones abiertas. Entrá con la nueva.
          </p>
        </div>
        <Button asChild className="min-h-touch w-full">
          <Link href="/login">Entrar</Link>
        </Button>
      </div>
    );
  }

  if (token === "") {
    return (
      <div className="flex flex-col items-center gap-4 text-center">
        <h2 className="text-lg font-semibold">Enlace incompleto</h2>
        <p className="text-sm text-muted-foreground">
          Abrí el enlace tal como llegó al correo, sin recortarlo.
        </p>
        <Button asChild variant="outline" className="min-h-touch w-full">
          <Link href="/forgot-password">Pedir uno nuevo</Link>
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Elegí una contraseña nueva</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Al cambiarla se cierran todas tus sesiones abiertas.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="password">Contraseña nueva</Label>
        <Input
          id="password"
          type="password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
          }}
          required
          minLength={10}
          autoComplete="new-password"
          enterKeyHint="go"
          className="min-h-touch"
        />
        <p className="text-xs text-muted-foreground">Al menos 10 caracteres.</p>
      </div>

      {reset.isError && (
        <p role="alert" className="text-sm text-destructive">
          {reset.error instanceof ApiError
            ? reset.error.message
            : "No se pudo cambiar la contraseña"}
        </p>
      )}

      <Button
        type="submit"
        className="min-h-touch w-full"
        disabled={reset.isPending}
      >
        {reset.isPending ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          "Cambiar contraseña"
        )}
      </Button>
    </form>
  );
}
