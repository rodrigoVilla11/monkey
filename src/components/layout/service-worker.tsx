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
    if (!("serviceWorker" in navigator)) return;

    if (!isProduction) {
      void cleanUpInDevelopment();
      return;
    }

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

/**
 * En desarrollo: desinstalar cualquier Service Worker y borrar sus cachés.
 *
 * No alcanza con no registrarlo. Un SW que quedó instalado sigue controlando
 * el origen para siempre, y `localhost:3000` es el mismo origen para el build
 * de producción y para `next dev`. Basta con levantar la imagen de Docker una
 * vez en ese puerto para que el SW quede ahí.
 *
 * Y entonces la regla cache-first de `/_next/static/**` —correcta en
 * producción, donde el nombre del chunk lleva el hash del contenido— pasa a
 * ser una trampa: en desarrollo Turbopack nombra los chunks por la ruta del
 * archivo, no por su contenido, así que el navegador sirve el JS viejo bajo el
 * mismo nombre por un año. La pantalla no cambia por más que se recargue, y
 * uno termina buscando un bug que ya arregló.
 *
 * Pasó de verdad, y no había forma de darse cuenta desde la app.
 */
const cleanUpInDevelopment = async (): Promise<void> => {
  /**
   * El desregistro va sin esperar a propósito. `unregister()` puede no
   * resolver NUNCA si el worker quedó atascado instalando —pasa apenas se
   * registra en desarrollo un `/sw.js` de producción, porque su manifiesto de
   * precarga apunta a chunks hasheados que acá no existen— y esperarlo
   * bloquearía el borrado de los cachés, que es lo que de verdad importa.
   */
  void navigator.serviceWorker.getRegistrations().then((registrations) => {
    for (const one of registrations) void one.unregister();
  });

  if (!("caches" in window)) return;

  // Todos los cachés y no solo los `monkey-*`: el de precarga lo nombra
  // Serwist y dejarlo serviría el app shell viejo igual.
  const names = await caches.keys();
  if (names.length === 0) return;

  await Promise.allSettled(names.map((name) => caches.delete(name)));

  /**
   * Una recarga para que la página se sirva de la red y no del controlador
   * viejo, que sigue vivo hasta la próxima navegación.
   *
   * La condición de recargar es "había cachés", no "había registros": un
   * registro atascado no se va nunca y usarlo como condición sería un bucle
   * infinito de recargas. Los cachés, en cambio, acaban de quedar vacíos, así
   * que en la carga siguiente no se vuelve a entrar acá.
   */
  window.location.reload();
};
