"use client";

import { useEffect, useState } from "react";

/**
 * Valor que se actualiza recién cuando deja de cambiar durante `delay` ms.
 *
 * Lo usa el buscador del listado: sin esto, cada tecla dispara un request y la
 * lista parpadea mientras se escribe.
 */
export const useDebounced = <T>(value: T, delay: number): T => {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(value);
    }, delay);
    return () => {
      clearTimeout(timer);
    };
  }, [value, delay]);

  return debounced;
};
