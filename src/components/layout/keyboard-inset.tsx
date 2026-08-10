"use client";

import { useEffect } from "react";

/**
 * Publica el alto del teclado en `--keyboard-inset` y saca al documento del
 * limbo en el que iOS lo deja al cerrarlo.
 *
 * El teclado de iOS no achica el viewport de LAYOUT, solo el visual: para el
 * CSS la pantalla sigue midiendo lo mismo y todo lo que está `fixed` abajo
 * queda tapado. La única fuente de verdad es `visualViewport`, y esto la
 * traduce a una variable que puede usar cualquier hoja de estilos.
 *
 * Es a propósito que no haya ningún estado acá adentro: solo se lee la altura
 * actual y se escribe. Un booleano tipo `teclado abierto` parece más simple
 * hasta que iOS manda dos o tres `resize` por cada aparición del teclado (la
 * animación, la barra de sugerencias, el autocompletado) y el booleano queda
 * al revés de la realidad — con la app estirada como si el teclado siguiera
 * ahí y sin ningún evento futuro que la acomode. Ver `ui/drawer.tsx`.
 */

/**
 * Abajo de esto no es un teclado: es la barra de direcciones de Safari
 * apareciendo, o un redondeo. Un teclado de iPhone nunca mide menos de 200px.
 */
const KEYBOARD_MIN_HEIGHT = 80;

export function KeyboardInset() {
  useEffect(() => {
    const viewport = window.visualViewport;
    if (viewport === null) return;

    const root = document.documentElement;
    let frame = 0;
    let settle: ReturnType<typeof setTimeout> | undefined;

    /**
     * Al cerrar el teclado, iOS a veces deja el documento desplazado hacia
     * arriba aunque no haya nada que scrollear: el header fijo se va de la
     * pantalla, la bottom nav queda flotando en el medio y los toques caen
     * corridos. Como el documento no tiene sobrante, no hay forma de volver
     * arrastrando — la app se siente trabada.
     *
     * Solo se corrige ese estado imposible (scroll > 0 sin contenido que lo
     * justifique). Una pantalla que sí scrollea de verdad, como el registro,
     * se queda donde el usuario la dejó.
     */
    const unstick = (): void => {
      const scroller = document.scrollingElement ?? root;
      if (
        scroller.scrollTop > 0 &&
        scroller.scrollHeight <= scroller.clientHeight + 1
      ) {
        scroller.scrollTop = 0;
      }
    };

    const sync = (): void => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        /**
         * `offsetTop` descuenta lo que iOS ya desplazó por su cuenta para
         * mostrar el input: los elementos `fixed` se posicionan contra el
         * viewport de layout, así que sin esa resta el drawer se iría de más.
         */
        const gap = window.innerHeight - viewport.height - viewport.offsetTop;
        const inset = gap > KEYBOARD_MIN_HEIGHT ? Math.round(gap) : 0;

        root.style.setProperty("--keyboard-inset", `${String(inset)}px`);

        if (inset === 0) {
          unstick();
          // El scroll que hay que deshacer puede llegar un tick después del
          // último `resize`, ya con el teclado fuera de pantalla.
          clearTimeout(settle);
          settle = setTimeout(unstick, 300);
        }
      });
    };

    viewport.addEventListener("resize", sync);
    viewport.addEventListener("scroll", sync);
    sync();

    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(settle);
      viewport.removeEventListener("resize", sync);
      viewport.removeEventListener("scroll", sync);
      root.style.setProperty("--keyboard-inset", "0px");
    };
  }, []);

  return null;
}
