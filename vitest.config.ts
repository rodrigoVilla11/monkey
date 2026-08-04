import { defineConfig } from "vitest/config";

/**
 * Tests unitarios y de arquitectura: sin base de datos, sin red, rápidos.
 * Los que sí tocan Postgres viven en vitest.integration.config.ts.
 */
export default defineConfig({
  // Resuelve el alias @/* del tsconfig, nativo desde Vite 7.
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    include: ["src/tests/unit/**/*.test.ts", "src/tests/arch/**/*.test.ts"],
    globals: false,
    restoreMocks: true,
    coverage: {
      provider: "v8",
      include: ["src/shared/**", "src/server/services/**"],
      reporter: ["text", "html"],
    },
  },
});
