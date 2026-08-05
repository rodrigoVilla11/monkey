/**
 * Puente con el Service Worker.
 *
 * Resuelve uno de los requisitos explícitos del brief: el SW NUNCA puede
 * servir respuestas cacheadas de otro usuario o de otro Space.
 *
 * El SW mantiene un caché por Space (`monkey-api-{spaceId}`) y sella cada
 * respuesta con el usuario que la pidió. Desde acá se le avisa en los dos
 * momentos en que eso puede quedar obsoleto:
 *
 *   · al cerrar sesión        → purgar todo
 *   · al cambiar de Space      → purgar todo
 *   · al identificarse         → decirle quién es el usuario actual
 *
 * Todo es best-effort: si no hay SW registrado (desarrollo, o un navegador que
 * no los soporta) estas funciones no hacen nada y la app funciona igual.
 */

interface SwMessage {
  readonly type: "PURGE_API_CACHES" | "SET_SESSION_USER";
  readonly userId?: string | undefined;
}

const post = async (message: SwMessage): Promise<void> => {
  if (typeof navigator === "undefined") return;
  if (!("serviceWorker" in navigator)) return;

  try {
    const registration = await navigator.serviceWorker.getRegistration();
    // `active` y no `installing`: solo el que está sirviendo puede purgar.
    registration?.active?.postMessage(message);
  } catch {
    // Un SW que no responde no puede bloquear un logout. La caché de TanStack
    // Query ya se limpió, que es lo que se ve en pantalla.
  }
};

export const purgeApiCaches = async (userId?: string): Promise<void> => {
  await post({ type: "PURGE_API_CACHES", userId });
};

export const setServiceWorkerUser = async (
  userId: string | undefined,
): Promise<void> => {
  await post({ type: "SET_SESSION_USER", userId });
};
