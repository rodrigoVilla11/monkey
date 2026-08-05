/**
 * Puente con el Service Worker.
 *
 * Resuelve uno de los requisitos explícitos del brief: el SW NUNCA puede
 * servir respuestas cacheadas de otro usuario o de otro Space. Se le avisa en
 * dos momentos:
 *
 *   · al cerrar sesión
 *   · al cambiar de Space activo
 *
 * El SW llega en el incremento 8; este código ya funciona sin él (si no hay
 * ninguno registrado, no hace nada) para que el orden de los incrementos no
 * deje un agujero abierto en el medio.
 */
export const purgeApiCaches = async (): Promise<void> => {
  if (typeof navigator === "undefined") return;
  if (!("serviceWorker" in navigator)) return;

  try {
    const registration = await navigator.serviceWorker.getRegistration();
    registration?.active?.postMessage({ type: "PURGE_API_CACHES" });
  } catch {
    // Un SW que no responde no puede bloquear un logout: la caché de TanStack
    // Query ya se limpió, que es lo que se ve en pantalla.
  }
};
