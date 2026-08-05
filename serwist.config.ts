import { serwist } from "@serwist/next/config";

/**
 * Configuración del Service Worker.
 *
 * Se usa el **modo configurador** de Serwist y no el plugin de webpack porque
 * Next 16 compila con Turbopack por defecto, y el plugin viejo obliga a
 * volver a webpack para todo el build.
 *
 * Como contrapartida, el SW se construye en un paso aparte: `pnpm build` corre
 * `next build` y después `serwist build`. Ese orden importa — el manifiesto de
 * precarga se arma leyendo los archivos hasheados que dejó Next.
 *
 * Efecto secundario bienvenido: en desarrollo no hay SW porque nadie corre
 * `serwist build`. Un Service Worker cacheando el app shell mientras se
 * trabaja hace que los cambios no aparezcan y se pierdan horas buscando un bug
 * que no existe.
 */
export default serwist({
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
  /**
   * Qué entra en la PRECARGA (se baja al instalar) y qué se cachea en runtime.
   *
   * Precargar todo el JS serían ~3 MB en la primera visita, sobre una conexión
   * móvil, antes de que la persona vea nada. Se descartó a propósito.
   *
   * El reparto es el que pide el brief: shell precargado, assets estáticos con
   * cache-first. En la práctica:
   *
   *   · precarga  → CSS, página offline y manifest (~70 KB)
   *   · runtime   → los chunks de JS, con CacheFirst (ver src/app/sw.ts).
   *                 Tienen hash en el nombre, así que cachearlos para siempre
   *                 es seguro, y quedan guardados apenas se visita la pantalla
   *                 que los usa.
   *
   * Contrapartida honesta: una pantalla que nunca se abrió no funciona sin
   * conexión la primera vez. Se prefiere eso a 3 MB de descarga inicial;
   * cualquier pantalla ya visitada sí funciona offline.
   */
  globDirectory: ".next",
  globPatterns: ["static/**/*.{css,woff,woff2}"],
  /**
   * Los globs se resuelven relativos a `.next`, así que salen como
   * `static/chunks/x.css`, pero Next los sirve bajo `/_next/`. Sin este
   * prefijo la precarga pide una URL que no existe y la instalación del
   * Service Worker falla entera — en silencio, porque nadie mira la consola
   * de un teléfono.
   */
  modifyURLPrefix: { "": "/_next/" },
  // Los archivos de `public/` se sirven desde la raíz.
  additionalPrecacheEntries: [
    { url: "/offline", revision: null },
    { url: "/manifest.webmanifest", revision: null },
  ],
  globIgnores: ["**/*.map", "**/sw.js"],
  maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
});
