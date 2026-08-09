import { COMPACT_BELOW, monkeyMark } from "../../../scripts/pwa-assets.config";

import { cn } from "@/lib/utils";

/**
 * La marca, dibujada en pantalla con el MISMO path que el ícono instalado.
 *
 * El SVG viene como string de `scripts/pwa-assets.config` porque de ahí lo saca
 * también el generador de PNG: si esto fuera JSX aparte, el logo de adentro de
 * la app y el del springboard del iPhone se irían separando con cada retoque y
 * nadie se enteraría hasta ver los dos juntos.
 *
 * `dangerouslySetInnerHTML` acá no es peligroso: el contenido es una constante
 * del repo, no hay nada del usuario en el medio.
 */
export function MonkeyMark({
  className,
  size = 48,
  framed = false,
}: {
  className?: string;
  /** Tamaño en píxeles al que se va a ver. Decide si se dibuja la versión simple. */
  size?: number;
  /** Con la placa oscura de fondo y las esquinas redondeadas, como el ícono. */
  framed?: boolean;
}) {
  const mark = (
    <svg
      viewBox="0 0 100 100"
      aria-hidden
      focusable="false"
      className={cn(framed ? "size-[74%]" : className)}
      dangerouslySetInnerHTML={{
        __html: monkeyMark({ compact: size < COMPACT_BELOW }),
      }}
    />
  );

  if (!framed) return mark;

  /**
   * La placa no es del mismo negro en los dos temas a propósito. En claro sí
   * (es el ícono tal cual, y sobre blanco el hocico crudo se perdería); en
   * oscuro, negro sobre negro sería una placa invisible, así que se levanta
   * apenas del fondo.
   */
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-[22%]",
        "bg-[#09090b] ring-1 ring-black/5",
        "dark:bg-white/8 dark:ring-white/10",
        className,
      )}
    >
      {mark}
    </span>
  );
}

/**
 * El nombre escrito: mon**K**ey.
 *
 * La K va en el color de marca porque ahí está el chiste — es la misma llave
 * que el ícono tiene por nariz. En `aria-label` viaja "monKey" de una pieza
 * para que un lector de pantalla no lo lea en dos tiempos.
 */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span
      className={cn("font-semibold tracking-tight", className)}
      aria-label="monKey"
    >
      <span aria-hidden>
        mon<span className="text-brand">K</span>ey
      </span>
    </span>
  );
}

/** Marca completa: ícono arriba, nombre abajo. Para las pantallas sin sesión. */
export function BrandLockup({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-col items-center gap-3", className)}>
      <MonkeyMark size={64} framed className="size-16 shadow-lg" />
      <Wordmark className="text-2xl" />
    </div>
  );
}
