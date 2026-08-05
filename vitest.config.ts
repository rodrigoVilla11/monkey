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
    /**
     * Algunos módulos bajo test (el rate limiter, por ejemplo) importan `env`,
     * que valida al cargarse. Estos valores son solo para satisfacer esa
     * validación: los tests unitarios nunca abren una conexión ni mandan un
     * mail. Lo que toca la base vive en vitest.integration.config.ts.
     */
    env: {
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://monkey:monkey@localhost:5443/monkey_test",
      AUTH_SECRET: "test-secret-de-al-menos-32-caracteres-largo",
      APP_URL: "http://localhost:3000",
      MAIL_DRIVER: "console",
    },
    coverage: {
      provider: "v8",
      include: ["src/shared/**", "src/server/services/**"],
      reporter: ["text", "html"],
    },
  },
});
