"use client";

import { useMutation } from "@tanstack/react-query";
import { Loader2, MailCheck } from "lucide-react";
import Link from "next/link";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api-client";

/**
 * Recuperación de contraseña.
 *
 * La respuesta es SIEMPRE la misma, exista o no la cuenta: el servidor
 * responde 204 en los dos casos y la pantalla dice lo mismo. Distinguirlos
 * convertiría esto en un verificador de qué emails están registrados.
 */
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");

  const request = useMutation({
    mutationFn: () => api.post("/auth/password/forgot", { email }),
  });

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    request.mutate();
  };

  if (request.isSuccess) {
    return (
      <div className="flex flex-col items-center gap-4 text-center">
        <MailCheck className="size-12 text-muted-foreground" />
        <div>
          <h2 className="text-lg font-semibold">Revisá tu correo</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Si hay una cuenta con ese email, te llegó un enlace para cambiar la
            contraseña. Vence en una hora.
          </p>
        </div>
        <Button asChild variant="outline" className="min-h-touch w-full">
          <Link href="/login">Volver</Link>
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Recuperar contraseña</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Te mandamos un enlace para elegir una nueva.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          type="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
          }}
          required
          autoComplete="email"
          inputMode="email"
          autoCapitalize="none"
          autoCorrect="off"
          enterKeyHint="send"
          className="min-h-touch"
        />
      </div>

      <Button
        type="submit"
        className="min-h-touch w-full"
        disabled={request.isPending}
      >
        {request.isPending ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          "Enviar enlace"
        )}
      </Button>

      <p className="text-center">
        <Link
          href="/login"
          className="text-sm text-muted-foreground underline underline-offset-4"
        >
          Volver
        </Link>
      </p>
    </form>
  );
}
