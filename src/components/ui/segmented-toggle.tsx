"use client";

import { cn } from "@/lib/utils";

/**
 * Píldora con opciones excluyentes: Gastos/Ingresos, Flujo/Patrimonio,
 * Día/Semana/Mes. Una sola implementación para que un arreglo de estilo o de
 * accesibilidad llegue a todas.
 */
export function SegmentedToggle<T extends string>({
  value,
  options,
  onChange,
  size = "default",
  label,
  className,
}: {
  value: T;
  options: readonly { readonly value: T; readonly label: string }[];
  onChange: (value: T) => void;
  size?: "default" | "sm";
  /** Nombre del grupo para lectores de pantalla. */
  label?: string;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn("flex rounded-full bg-secondary p-0.5", className)}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          onClick={() => {
            onChange(option.value);
          }}
          className={cn(
            "flex-1 rounded-full",
            size === "sm" ? "min-h-8 px-3 text-xs" : "min-h-touch text-sm",
            option.value === value && "bg-background shadow-sm",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
