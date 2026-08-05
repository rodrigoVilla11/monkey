import type { NextConfig } from "next";

/**
 * A propósito NO se valida el entorno acá.
 *
 * `next build` fuerza NODE_ENV=production, así que las reglas de producción
 * (https obligatorio, CRON_SECRET, driver de mail real) se dispararían en un
 * build local. Y en el build de Docker no hay secretos por diseño: el entorno
 * de build no es el de runtime.
 *
 * La validación real pasa al arrancar el server, en src/instrumentation.ts.
 */

const nextConfig: NextConfig = {
  // Imagen de Docker chica: solo el server + los node_modules que se usan.
  output: "standalone",
  reactStrictMode: true,
  poweredByHeader: false,

  typedRoutes: true,

  /**
   * Paquetes que NO tienen que pasar por el bundler del server:
   * - @node-rs/argon2 es un binario nativo (.node)
   * - pino resuelve sus transports en runtime
   */
  serverExternalPackages: ["@node-rs/argon2", "pino", "pino-pretty"],

  // Next 16 sacó ESLint del build: el lint corre en `pnpm check` / CI.
  typescript: {
    // Idem: `pnpm typecheck` es el que manda. Nunca poner `true` acá.
    ignoreBuildErrors: false,
  },
};

/**
 * El Service Worker NO se construye acá.
 *
 * Serwist se integra en modo configurador (ver `serwist.config.ts`) porque su
 * plugin de webpack obligaría a abandonar Turbopack en todo el build. El SW se
 * genera después, con `serwist build`, leyendo los archivos hasheados que dejó
 * Next.
 */
export default nextConfig;
