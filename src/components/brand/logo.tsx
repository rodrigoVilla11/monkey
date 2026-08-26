import Image from "next/image";

import { LOGO_PUBLIC_PATH, TAGLINE } from "../../../scripts/pwa-assets.config";

import { cn } from "@/lib/utils";

/**
 * La marca, en pantalla con el MISMO archivo que alimenta el ícono instalado.
 *
 * La ruta viene de `scripts/pwa-assets.config` porque de ahí lo saca también
 * el generador de PNG: si cada lado apuntara a su propia copia, el logo de
 * adentro de la app y el del springboard del iPhone se irían separando con
 * cada retoque y nadie se enteraría hasta ver los dos juntos.
 *
 * `unoptimized` a propósito: es un PNG chico de `public/`, no necesita pasar
 * por el optimizador de Next (que en el runtime de Docker pediría sharp).
 */
export function MonkeyMark({
  className,
  size = 48,
  framed = false,
}: {
  className?: string;
  /** Tamaño en píxeles al que se va a ver. */
  size?: number;
  /** Con la placa blanca de fondo y las esquinas redondeadas, como el ícono. */
  framed?: boolean;
}) {
  const mark = (
    <Image
      src={LOGO_PUBLIC_PATH}
      alt=""
      width={size}
      height={size}
      unoptimized
      className={cn(framed ? "size-[82%]" : className)}
    />
  );

  if (!framed) return mark;

  /**
   * La placa es blanca en los dos temas, igual que el ícono instalado: los
   * "blancos" del logo son transparencia, y sobre fondo oscuro los trazos
   * azul oscuro del mono se apagarían sin ella.
   */
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-[22%]",
        "bg-white ring-1 ring-black/10 dark:ring-white/10",
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
 * La K va en el azul de marca porque ahí está el chiste — es la misma K con
 * llave del logo. En `aria-label` viaja "monKey" de una pieza para que un
 * lector de pantalla no lo lea en dos tiempos.
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

/**
 * Marca completa: ícono arriba, nombre y eslogan abajo. Para las pantallas
 * sin sesión y las de carga. Todo en `span` con `block`, no `div`/`p`: el
 * login lo mete adentro de un `h1` y ahí un elemento de bloque es HTML
 * inválido.
 */
export function BrandLockup({ className }: { className?: string }) {
  return (
    <span className={cn("flex flex-col items-center gap-3", className)}>
      <MonkeyMark size={64} framed className="size-16 shadow-lg" />
      <span className="flex flex-col items-center gap-1">
        <Wordmark className="text-2xl" />
        <span className="text-sm text-muted-foreground">{TAGLINE}</span>
      </span>
    </span>
  );
}
