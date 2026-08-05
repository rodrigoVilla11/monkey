"use client";

import { useMutation } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError, api } from "@/lib/api-client";
import type { AuthResponse } from "@/shared/contracts/auth";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const login = useMutation({
    mutationFn: () =>
      api.post<AuthResponse>("/auth/login", {
        email,
        password,
        // Etiqueta para la pantalla de sesiones activas. Se manda el
        // fabricante, no el user-agent completo, que no le dice nada a nadie.
        deviceLabel: describeDevice(),
      }),
    onSuccess: () => {
      router.replace("/");
    },
  });

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    login.mutate();
  };

  return (
    <form onSubmit={submit} className="space-y-4">
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
          // Estos atributos son los que hacen que iOS ofrezca el llavero.
          autoComplete="email"
          inputMode="email"
          autoCapitalize="none"
          autoCorrect="off"
          enterKeyHint="next"
          className="min-h-touch"
        />
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor="password">Contraseña</Label>
          <Link
            href="/forgot-password"
            className="text-xs text-muted-foreground underline-offset-4 hover:underline"
          >
            ¿La olvidaste?
          </Link>
        </div>
        <Input
          id="password"
          type="password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
          }}
          required
          autoComplete="current-password"
          enterKeyHint="go"
          className="min-h-touch"
        />
      </div>

      {login.isError && (
        <p role="alert" className="text-sm text-destructive">
          {login.error instanceof ApiError
            ? login.error.message
            : "No se pudo iniciar sesión"}
        </p>
      )}

      <Button
        type="submit"
        className="min-h-touch w-full"
        disabled={login.isPending}
      >
        {login.isPending ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          "Entrar"
        )}
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        ¿No tenés cuenta?{" "}
        <Link
          href="/register"
          className="text-foreground underline underline-offset-4"
        >
          Crear una
        </Link>
      </p>
    </form>
  );
}

/** Etiqueta legible del dispositivo, sin volcar el user-agent entero. */
export const describeDevice = (): string => {
  if (typeof navigator === "undefined") return "Navegador";
  const ua = navigator.userAgent;

  if (ua.includes("iPhone")) return "iPhone";
  if (ua.includes("iPad")) return "iPad";
  if (ua.includes("Android")) return "Android";
  if (ua.includes("Macintosh")) return "Mac";
  if (ua.includes("Windows")) return "Windows";
  return "Navegador";
};
