"use client";

import { Delete } from "lucide-react";

import { cn } from "@/lib/utils";
import { getCurrencyExponent } from "@/shared/currency";
import { formatMoney, money } from "@/shared/money";

/**
 * Teclado numérico para el importe.
 *
 * Es un teclado PROPIO y no un `<input inputmode="decimal">` por tres razones:
 *
 *  1. Los dígitos se acumulan de derecha a izquierda, como una caja
 *     registradora. Lo que se teclea YA son unidades mínimas, así que no hay
 *     separador decimal que parsear y por lo tanto no hay ambigüedad entre
 *     "1.234" español e inglés.
 *  2. El teclado del sistema tapa media pantalla en un iPhone y empuja el
 *     resto del formulario fuera de vista.
 *  3. Las teclas se dimensionan para el pulgar (mucho más de 44px), que es lo
 *     que hace que cargar un gasto sean tres toques y no una pelea.
 */

const KEYS = [
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "",
  "0",
  "del",
] as const;

export function AmountPad({
  digits,
  currency,
  locale,
  onChange,
}: {
  digits: string;
  currency: string;
  locale: string;
  onChange: (next: string) => void;
}) {
  const exponent = getCurrencyExponent(currency);
  const amount = digits === "" ? 0n : BigInt(digits);

  const press = (key: string): void => {
    if (key === "del") {
      onChange(digits.slice(0, -1));
      return;
    }
    if (key === "") return;

    // Tope defensivo: 15 dígitos alcanzan para cualquier importe real y
    // evitan que alguien apoye el dedo y desborde la pantalla.
    if (digits.length >= 15) return;

    // Sin ceros a la izquierda: "007" no es un importe.
    const next = digits === "" && key === "0" ? "" : `${digits}${key}`;
    onChange(next);

    if (typeof navigator.vibrate === "function") navigator.vibrate(8);
  };

  return (
    <div className="flex flex-col gap-4">
      <output
        className="flex min-h-24 items-center justify-center text-center"
        aria-live="polite"
        aria-label="Importe"
      >
        <span
          className={cn(
            "font-semibold tabular-nums transition-colors",
            digits === "" ? "text-muted-foreground" : "text-foreground",
            // El tamaño baja al crecer el número para que no se corte a 375px.
            digits.length > 9
              ? "text-4xl"
              : digits.length > 6
                ? "text-5xl"
                : "text-6xl",
          )}
        >
          {formatMoney(money(amount, currency), locale)}
        </span>
      </output>

      <div className="grid grid-cols-3 gap-2">
        {KEYS.map((key, index) =>
          key === "" ? (
            <span key={`gap-${String(index)}`} />
          ) : (
            <button
              key={key}
              type="button"
              onClick={() => {
                press(key);
              }}
              aria-label={key === "del" ? "Borrar" : key}
              className={cn(
                "flex h-16 items-center justify-center rounded-xl text-2xl font-medium",
                "bg-secondary text-secondary-foreground",
                "active:scale-95 active:bg-accent motion-safe:transition-transform",
              )}
            >
              {key === "del" ? <Delete className="size-6" /> : key}
            </button>
          ),
        )}
      </div>

      {exponent > 0 && (
        <p className="text-center text-xs text-muted-foreground">
          Los últimos {exponent} dígitos son los decimales
        </p>
      )}
    </div>
  );
}
