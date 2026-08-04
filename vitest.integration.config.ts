import { defineConfig } from "vitest/config";

/**
 * Tests de integración: hablan con Postgres de verdad.
 * Acá viven los dos que más importan del brief —
 *   · space-isolation.test.ts  (ningún endpoint filtra datos de otro Space)
 *   · role-matrix.test.ts      (cada endpoint × cada rol → HTTP esperado)
 *
 * Corren en serie en un único worker: comparten una base y se resetean entre
 * archivos. Paralelizarlos daría flakiness, no velocidad.
 */
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    include: ["src/tests/integration/**/*.test.ts"],
    globals: false,
    restoreMocks: true,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    pool: "forks",
    fileParallelism: false,
    maxWorkers: 1,
    // Se agrega en el incremento 4, cuando exista la base a la que apuntar.
    // setupFiles: ["src/tests/integration/helpers/setup.ts"],
  },
});
