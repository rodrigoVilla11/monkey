import { defineConfig } from "vitest/config";

/**
 * Tests de integración: hablan con Postgres de verdad.
 * Acá viven los dos que más importan del brief —
 *   · space-isolation  (ningún endpoint filtra datos de otro Space)
 *   · role-matrix      (cada endpoint × cada rol → HTTP esperado)
 *
 * Corren en serie en un único worker: comparten una base y se resetean entre
 * archivos. Paralelizarlos daría flakiness, no velocidad.
 *
 * Apuntan al servicio `postgres-test` del compose (puerto 5443), que corre en
 * tmpfs. Nunca a la base de desarrollo.
 */
const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://monkey:monkey@localhost:5443/monkey_test?schema=public";

// `test.env` solo alcanza a los workers. El globalSetup corre en el proceso
// principal de Vitest, así que la variable tiene que existir ya acá.
process.env.DATABASE_URL = TEST_DATABASE_URL;

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    include: ["src/tests/integration/**/*.test.ts"],
    globals: false,
    restoreMocks: true,
    testTimeout: 30_000,
    hookTimeout: 120_000,
    pool: "forks",
    fileParallelism: false,
    maxWorkers: 1,
    /**
     * @node-rs/argon2 es un binario nativo (.node). Si Vite intenta
     * transformarlo, la resolución del binding falla; hay que dejar que lo
     * cargue Node directamente.
     */
    server: {
      deps: { external: [/@node-rs\/argon2/] },
    },
    globalSetup: ["src/tests/integration/helpers/global-setup.ts"],
    env: {
      NODE_ENV: "test",
      DATABASE_URL: TEST_DATABASE_URL,
      // Valores mínimos para que src/env.ts valide. No se usan de verdad acá.
      AUTH_SECRET: "test-secret-de-al-menos-32-caracteres-largo",
      APP_URL: "http://localhost:3000",
      MAIL_DRIVER: "console",
    },
  },
});
