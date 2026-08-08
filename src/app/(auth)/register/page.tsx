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

/**
 * Registro.
 *
 * La timezone y el locale se detectan del navegador y viajan en el registro.
 * Si no llegan, el servidor cae en los defaults del entorno. Nadie tiene que
 * elegir su huso horario en un formulario de alta.
 */
export default function RegisterPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const register = useMutation({
    mutationFn: () =>
      api.post<AuthResponse>("/auth/register", {
        name,
        email,
        password,
        ...detectRegion(),
      }),
    onSuccess: (data) => {
      /**
       * Si el correo no salió, la pantalla de verificación tiene que decirlo:
       * la cuenta EXISTE y la sesión está abierta, pero nadie va a recibir
       * nada. Sin esto, la persona espera un mail que no viene.
       */
      router.replace(
        data.verificationEmailSent === false
          ? "/verify-email?mail=failed"
          : "/verify-email",
      );
    },
  });

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    register.mutate();
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="name">Nombre</Label>
        <Input
          id="name"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
          }}
          required
          autoComplete="name"
          enterKeyHint="next"
          className="min-h-touch"
        />
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
          enterKeyHint="next"
          className="min-h-touch"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="password">Contraseña</Label>
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
        <p className="text-xs text-muted-foreground">
          Al menos 10 caracteres. Una frase larga es mejor que un símbolo raro.
        </p>
      </div>

      {register.isError && (
        <p role="alert" className="text-sm text-destructive">
          {register.error instanceof ApiError
            ? register.error.message
            : "No se pudo crear la cuenta"}
        </p>
      )}

      <Button
        type="submit"
        className="min-h-touch w-full"
        disabled={register.isPending}
      >
        {register.isPending ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          "Crear cuenta"
        )}
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        ¿Ya tenés cuenta?{" "}
        <Link
          href="/login"
          className="text-foreground underline underline-offset-4"
        >
          Entrar
        </Link>
      </p>
    </form>
  );
}

/**
 * Datos regionales del navegador.
 *
 * Se mandan solo si son válidos según el formato que espera el contrato; si
 * algo no encaja, se omite y decide el servidor. No hay ningún país
 * hardcodeado en el cliente.
 */
const detectRegion = (): {
  timezone?: string;
  locale?: string;
} => {
  const result: { timezone?: string; locale?: string } = {};

  try {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (typeof timezone === "string" && timezone !== "") {
      result.timezone = timezone;
    }
  } catch {
    // Sin Intl utilizable: que decida el servidor.
  }

  const language = navigator.language;
  if (/^[a-z]{2}(-[A-Z]{2})?$/.test(language)) {
    result.locale = language;
  }

  return result;
};
