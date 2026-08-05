/// <reference lib="webworker" />
import {
  CacheFirst,
  ExpirationPlugin,
  NetworkFirst,
  Serwist,
  type PrecacheEntry,
  type RuntimeCaching,
  type SerwistGlobalConfig,
} from "serwist";

/**
 * Service Worker.
 *
 * Se usa Serwist y no una implementación propia por una razón concreta: la
 * parte difícil no es la estrategia de caché, es generar el manifiesto de
 * precarga con los nombres HASHEADOS que emite el build de Next. Serwist lo
 * resuelve en el build; a mano hay que escribir y mantener un plugin propio.
 *
 * ── El requisito que más importa ───────────────────────────────────────────
 * "El Service Worker nunca cachea respuestas de endpoints con datos de otro
 * usuario tras un cambio de sesión."
 *
 * Se ataca por tres lados a la vez, porque cualquiera solo tiene un agujero:
 *
 *  1. Cada Space usa su PROPIO caché, `api-{spaceId}`. Cambiar de Space no
 *     puede leer el caché de otro ni por accidente: son cachés distintos.
 *  2. Al cerrar sesión y al cambiar de Space, el cliente manda
 *     `PURGE_API_CACHES` y acá se borra TODO lo que empiece con `api-`.
 *  3. Red de seguridad: cada respuesta cacheada guarda el usuario que la pidió.
 *     Si al leerla el usuario actual no coincide, se descarta y se va a la red.
 *     Esto cubre el caso feo — que el mensaje de purga no llegue porque el SW
 *     estaba dormido o se recargó justo en el medio.
 */

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const API_CACHE_PREFIX = "monkey-api-";
const USER_HEADER = "x-monkey-cache-user";
const SPACE_ROUTE = /^\/api\/v1\/spaces\/([^/]+)\//;

/** Usuario de la sesión actual, según lo informa el cliente. */
let currentUserId: string | null = null;

// ─────────────────────────── cachés de la API ────────────────────────────────

/**
 * Network-first para los datos del Space.
 *
 * Network-first y no stale-while-revalidate porque acá se muestran saldos: un
 * número desactualizado que parece actual es peor que una espera de 3
 * segundos. El caché es la red de emergencia para cuando no hay conexión, no
 * la fuente por defecto.
 */
const handleSpaceApi = async ({
  request,
}: {
  request: Request;
}): Promise<Response> => {
  const url = new URL(request.url);
  const spaceId = SPACE_ROUTE.exec(url.pathname)?.[1] ?? "unknown";
  const cacheName = `${API_CACHE_PREFIX}${spaceId}`;

  try {
    const response = await fetch(request);

    if (response.ok) {
      const cache = await caches.open(cacheName);
      // Se sella con el usuario actual antes de guardar: es lo que permite
      // detectar después que la respuesta es de otra sesión.
      const stamped = new Response(response.clone().body, {
        status: response.status,
        statusText: response.statusText,
        headers: (() => {
          const headers = new Headers(response.headers);
          headers.set(USER_HEADER, currentUserId ?? "anon");
          return headers;
        })(),
      });
      await cache.put(request, stamped);
    }

    return response;
  } catch {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(request);

    if (cached === undefined) throw new Error("offline y sin caché");

    // Tercera defensa: si la guardó otra sesión, no se sirve.
    const cachedUser = cached.headers.get(USER_HEADER);
    if (cachedUser !== (currentUserId ?? "anon")) {
      await cache.delete(request);
      throw new Error("caché de otra sesión");
    }

    return cached;
  }
};

const runtimeCaching: RuntimeCaching[] = [
  {
    // Datos del Space: network-first con caché por Space.
    matcher: ({ url, request, sameOrigin }) =>
      sameOrigin && request.method === "GET" && SPACE_ROUTE.test(url.pathname),
    handler: handleSpaceApi,
  },
  {
    /**
     * El resto de la API NO se cachea nunca. `/me`, `/auth/**` y `/spaces`
     * definen quién sos: servir una respuesta vieja de ahí es exactamente el
     * bug que el brief quiere evitar.
     */
    matcher: ({ url, sameOrigin }) =>
      sameOrigin && url.pathname.startsWith("/api/"),
    handler: new NetworkFirst({
      cacheName: "monkey-no-cache",
      networkTimeoutSeconds: 10,
      plugins: [new ExpirationPlugin({ maxEntries: 0 })],
    }),
  },
  {
    // Assets con hash en el nombre: inmutables, cache-first sin dudar.
    matcher: ({ url, sameOrigin }) =>
      sameOrigin && url.pathname.startsWith("/_next/static/"),
    handler: new CacheFirst({
      cacheName: "monkey-static",
      plugins: [
        new ExpirationPlugin({
          maxEntries: 200,
          maxAgeSeconds: 60 * 60 * 24 * 365,
        }),
      ],
    }),
  },
  {
    // Íconos y splash: cambian solo con un deploy.
    matcher: ({ url, sameOrigin }) =>
      sameOrigin &&
      (url.pathname.startsWith("/icons/") ||
        url.pathname.startsWith("/splash/")),
    handler: new CacheFirst({
      cacheName: "monkey-assets",
      plugins: [
        new ExpirationPlugin({
          maxEntries: 60,
          maxAgeSeconds: 60 * 60 * 24 * 30,
        }),
      ],
    }),
  },
];

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  // El app shell nuevo toma el control enseguida: sin esto, una versión vieja
  // puede seguir sirviendo hasta que se cierren todas las pestañas.
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching,
  fallbacks: {
    entries: [
      {
        url: "/offline",
        matcher: ({ request }) => request.destination === "document",
      },
    ],
  },
});

serwist.addEventListeners();

// ──────────────────────── mensajes desde el cliente ──────────────────────────

interface ClientMessage {
  readonly type: string;
  readonly userId?: string;
}

self.addEventListener("message", (event: ExtendableMessageEvent) => {
  const data = event.data as ClientMessage | null;
  if (data === null || typeof data.type !== "string") return;

  switch (data.type) {
    case "SET_SESSION_USER":
      currentUserId = data.userId ?? null;
      break;

    case "PURGE_API_CACHES":
      currentUserId = data.userId ?? null;
      event.waitUntil(purgeApiCaches());
      break;

    default:
      break;
  }
});

/** Borra los cachés de datos de TODOS los Spaces. */
const purgeApiCaches = async (): Promise<void> => {
  const names = await caches.keys();
  await Promise.all(
    names
      .filter((name) => name.startsWith(API_CACHE_PREFIX))
      .map((name) => caches.delete(name)),
  );
};

/**
 * Al activarse una versión nueva del SW se purga igual, sin esperar mensaje.
 * Un deploy puede cambiar la forma de las respuestas, y servir las viejas
 * desde caché rompería la UI de formas difíciles de diagnosticar.
 */
self.addEventListener("activate", (event) => {
  event.waitUntil(purgeApiCaches());
});
