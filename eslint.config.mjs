// @ts-check
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import tseslint from "typescript-eslint";

/**
 * Además del lint habitual, este archivo hace cumplir tres invariantes de
 * arquitectura del plan. Son reglas, no convenciones: si las rompés, no compila.
 *
 *  1. El PrismaClient sin scope solo se importa desde `src/server/db/**`.
 *     Fuera de ahí se usa `forSpace(spaceId)` o `systemClient()`.
 *  2. `src/shared/**` no importa Next, React ni Prisma: tiene que poder
 *     consumirlo un cliente Expo tal cual.
 *  3. `process.env` solo se lee en `src/env.ts`.
 */

const RESTRICTED_DB_IMPORTS = {
  patterns: [
    {
      group: ["@/server/db/client", "**/server/db/client", "@prisma/client"],
      message:
        "No importes el PrismaClient sin scope. Usá forSpace(spaceId) de @/server/db/scoped, o systemClient() de @/server/db/system si de verdad necesitás cruzar Spaces.",
    },
  ],
};

export default tseslint.config(
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "src/generated/**",
      "public/**",
      "next-env.d.ts",
      "coverage/**",
      "var/**",
    ],
  },

  ...nextCoreWebVitals,
  ...nextTypescript,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // El brief pide `strict` sin `any`. Esto lo hace cumplir de verdad.
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unsafe-assignment": "error",
      "@typescript-eslint/no-unsafe-member-access": "error",
      "@typescript-eslint/no-unsafe-call": "error",
      "@typescript-eslint/no-unsafe-return": "error",
      "@typescript-eslint/no-unsafe-argument": "error",
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // Promesas colgadas en handlers de API = respuestas a medio escribir.
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/require-await": "error",
      "@typescript-eslint/switch-exhaustiveness-check": "error",

      // "Sin console.log en el código final": se usa el logger de pino.
      "no-console": "error",

      // Invariante 1
      "no-restricted-imports": ["error", RESTRICTED_DB_IMPORTS],

      // Invariante 3
      "no-restricted-properties": [
        "error",
        {
          object: "process",
          property: "env",
          message:
            "Leé la config desde `env` (@/env), que la valida con Zod al arranque.",
        },
      ],
    },
  },

  // Invariante 2: src/shared tiene que quedar portable.
  {
    files: ["src/shared/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "next",
                "next/*",
                "react",
                "react-dom",
                "@prisma/client",
                "@/server/**",
                "@/app/**",
                "@/lib/**",
                "@/components/**",
                "@/env",
              ],
              message:
                "src/shared tiene que poder importarse desde un cliente Expo sin arrastrar Next, React ni Prisma.",
            },
          ],
        },
      ],
    },
  },

  // La capa de acceso a datos sí puede tocar el cliente crudo.
  {
    files: ["src/server/db/**/*.ts", "prisma/**/*.ts"],
    rules: { "no-restricted-imports": "off" },
  },

  // Archivos de configuración en JS plano: no están en el tsconfig, así que no
  // pueden pasar por las reglas que necesitan tipos.
  {
    files: ["**/*.mjs", "**/*.js", "**/*.cjs"],
    extends: [tseslint.configs.disableTypeChecked],
    rules: {
      "no-restricted-properties": "off",
    },
  },

  // Puntos de entrada del proceso: leen process.env por definición.
  {
    files: [
      "src/env.ts",
      "src/instrumentation.ts",
      "src/middleware.ts",
      "next.config.ts",
      "scripts/**/*.ts",
      "prisma/**/*.ts",
      "*.config.ts",
    ],
    rules: {
      "no-restricted-properties": "off",
    },
  },

  // Herramientas de línea de comandos: imprimir por stdout es su trabajo.
  {
    files: ["scripts/**/*.ts", "prisma/seed.ts"],
    rules: {
      "no-console": "off",
    },
  },

  // Los tests arman fixtures a mano y hablan con la base sin scope.
  {
    files: ["src/tests/**/*.ts"],
    rules: {
      "no-restricted-imports": "off",
      "no-restricted-properties": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },
);
