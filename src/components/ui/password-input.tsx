"use client";

import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * Campo de contraseña con ojo para verla.
 *
 * En un teléfono, escribir doce caracteres a ciegas y equivocarse en el noveno
 * es la forma más común de no poder entrar a una app. Poder mirar lo que uno
 * tecleó no es una comodidad: es lo que evita el segundo y el tercer intento.
 *
 * ── Los detalles que lo hacen usable en iOS ─────────────────────────────────
 *
 * Al pasar el campo a `text`, el teclado empieza a tratarlo como texto común:
 * te pone mayúscula al principio y te "corrige" la palabra. Una contraseña
 * corregida por el autocorrector es exactamente el bug que este componente
 * viene a evitar, así que se desactivan las tres cosas siempre — mostrando y
 * ocultando.
 *
 * El botón es `type="button"` a propósito: dentro de un `<form>`, el default
 * es `submit`, y tocar el ojo mandaría el formulario a medio llenar.
 *
 * Y no se le pone `tabIndex={-1}`: es un control de verdad, y sacarlo del
 * tabulador deja a quien navega con teclado sin forma de llegar.
 */
export function PasswordInput({
  className,
  ...props
}: Omit<React.ComponentProps<typeof Input>, "type">) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      <Input
        type={visible ? "text" : "password"}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        // Lugar para el ojo: sin esto el texto le pasa por debajo.
        className={cn("pr-12", className)}
        {...props}
      />
      <button
        type="button"
        onClick={() => {
          setVisible(!visible);
        }}
        aria-label={visible ? "Ocultar la contraseña" : "Ver la contraseña"}
        aria-pressed={visible}
        className="absolute inset-y-0 right-0 flex min-w-touch items-center justify-center text-muted-foreground"
      >
        {visible ? (
          <EyeOff className="size-4.5" />
        ) : (
          <Eye className="size-4.5" />
        )}
      </button>
    </div>
  );
}
