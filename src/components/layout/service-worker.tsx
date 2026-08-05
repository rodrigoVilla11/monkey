"use client";

import { useEffect } from "react";

import { isProduction } from "@/shared/config";

/**
 * Registro del Service Worker.
 *
 * Se hace a mano y no con el helper de `@serwist/next` porque en modo
 * configurador el SW es un artefacto aparte, sin runtime inyectado.
 *
 * Solo en producción: en desarrollo `serwist build` no corre y `/sw.js` no
 * existe, así que registrarlo daría un 404 en consola en cada recarga.
 */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (!isProduction) return;
    if (!("serviceWorker" in navigator)) return;

    const register = (): void => {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
        // Un SW que no registra no rompe nada: la app funciona online igual.
        // No se muestra error porque no hay nada que la persona pueda hacer.
      });
    };

    /**
     * Se espera a que la página cargue del todo. Registrar durante la carga
     * inicial compite por ancho de banda con los recursos que la pantalla
     * necesita para pintarse.
     */
    if (document.readyState === "complete") {
      register();
      return;
    }

    window.addEventListener("load", register, { once: true });
    return () => {
      window.removeEventListener("load", register);
    };
  }, []);

  return null;
}
