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
 * Es a propósito que no se DEDUZCA nada acá adentro: solo se lee la altura
 * actual y se escribe. Un booleano tipo `teclado abierto` parece más simple
 * hasta que iOS manda dos o tres `resize` por cada aparición del teclado (la
 * animación, la barra de sugerencias, el autocompletado) y el booleano queda
 * al revés de la realidad — con la app estirada como si el teclado siguiera
 * ahí y sin ningún evento futuro que la acomode. Ver `ui/drawer.tsx`.
 *
 * Lo único que se recuerda es el último valor publicado, y solo para no
 * reescribirlo: no es un estado del que dependa ninguna decisión.
 */

/**
 * Abajo de esto no es un teclado: es la barra de direcciones de Safari
 * apareciendo, o un redondeo. Un teclado de iPhone nunca mide menos de 200px.
 */
const KEYBOARD_MIN_HEIGHT = 80;

/**
 * ¿El navegador está manejando el scroll para mantener el cursor a la vista?
 *
 * Se lee del DOM en el momento en vez de guardarse, por lo mismo que no hay un
 * booleano de "teclado abierto": el foco cambia por caminos que no siempre
 * avisan —el usuario toca otro campo, iOS mueve el foco al cerrar el teclado—
 * y una copia se queda vieja.
 *
 * Cuenta cualquier control que abra teclado o selector: un `date` no recibe
 * texto pero iOS igual sube su rueda y desplaza el documento igual que con el
 * teclado.
 */
const browserOwnsScroll = (): boolean => {
  const el = document.activeElement;
  if (!(el instanceof HTMLElement)) return false;
  return (
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLSelectElement ||
    el.isContentEditable
  );
};

export function KeyboardInset() {
  useEffect(() => {
    const viewport = window.visualViewport;
    if (viewport === null) return;

    const root = document.documentElement;
    let frame = 0;
    let settle: ReturnType<typeof setTimeout> | undefined;
    /** Último valor publicado, para no reescribir el mismo. */
    let last = -1;

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
     *
     * Y NUNCA con un campo enfocado. Ese desplazamiento "sin sentido" es
     * exactamente lo que hace iOS mientras se escribe para que el cursor no
     * quede debajo del teclado: corregirlo ahí es pelearse con el navegador.
     * Escribir el scroll dispara el `scroll` de visualViewport, que vuelve a
     * `sync`, que puede mover `--keyboard-inset` (depende de `offsetTop`, que
     * es posición de scroll), y el cambio de CSS hace que el navegador
     * re-scrollee para reencuadrar el cursor. La pantalla tiembla hasta que se
     * suelta el campo. El arreglo de verdad es no entrar en la rueda: al
     * cerrarse el teclado el foco ya se fue, y ahí sí se corrige.
     */
    const unstick = (): void => {
      if (browserOwnsScroll()) return;

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

        // Solo se escribe cuando cambió de verdad. Tocar una custom property
        // de `:root` invalida el estilo de TODO el árbol, y acá se llega en
        // cada scroll del viewport visual —o sea, en cada pulsación con el
        // teclado abierto—. Escribir el mismo valor una y otra vez es recalcular
        // la página entera por nada.
        if (inset !== last) {
          last = inset;
          root.style.setProperty("--keyboard-inset", `${String(inset)}px`);
        }

        if (inset === 0) {
          unstick();
          // El scroll que hay que deshacer puede llegar un tick después del
          // último `resize`, ya con el teclado fuera de pantalla.
          clearTimeout(settle);
          settle = setTimeout(unstick, 300);
        }
      });
    };

    /**
     * Al soltar un campo se reintenta, porque el `resize` de iOS suele llegar
     * ANTES de que el foco se vaya: en ese momento `unstick` se abstiene —el
     * campo todavía está enfocado— y sin esto habría que confiar en que el
     * temporizador de 300ms caiga del lado correcto.
     */
    const onFocusOut = (): void => {
      clearTimeout(settle);
      settle = setTimeout(unstick, 300);
    };

    viewport.addEventListener("resize", sync);
    viewport.addEventListener("scroll", sync);
    document.addEventListener("focusout", onFocusOut);
    sync();

    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(settle);
      viewport.removeEventListener("resize", sync);
      viewport.removeEventListener("scroll", sync);
      document.removeEventListener("focusout", onFocusOut);
      root.style.setProperty("--keyboard-inset", "0px");
    };
  }, []);

  return null;
}
