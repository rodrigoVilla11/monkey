import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Reglas de arquitectura verificadas sobre el código fuente.
 *
 * ESLint ya cubre la mayoría vía no-restricted-imports, pero estas se testean
 * igual por dos razones: ESLint se puede desactivar con un comentario, y estas
 * reglas también atrapan cosas que el linter no ve (SQL crudo en strings,
 * instanciaciones directas de PrismaClient).
 *
 * A medida que crezca el proyecto se suman acá:
 *  · todo route.ts de app/api/v1 tiene que estar en routes.manifest.ts
 *  · ningún service puede recibir spaceId sin pasar por requireSpaceAccess
 */

const SRC = resolve(import.meta.dirname, "../..");

const walk = (dir: string): string[] => {
  const entries: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "generated" || name === "node_modules") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      entries.push(...walk(full));
    } else if (/\.(ts|tsx)$/.test(name)) {
      entries.push(full);
    }
  }
  return entries;
};

/**
 * Se analiza el código, no los comentarios: si no, cualquier docstring que
 * mencione `process.env` o `PrismaClient` dispararía un falso positivo.
 * El `(?<!:)` evita cortar en el `//` de una URL.
 */
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(?<!:)\/\/.*$/gm, "");

const sourceFiles = walk(SRC).map((file) => ({
  path: relative(SRC, file).replaceAll("\\", "/"),
  content: stripComments(readFileSync(file, "utf8")),
}));

const filesUnder = (prefix: string) =>
  sourceFiles.filter((f) => f.path.startsWith(prefix));

describe("reglas de arquitectura", () => {
  it("encuentra archivos para analizar", () => {
    expect(sourceFiles.length).toBeGreaterThan(0);
  });

  describe("src/shared tiene que quedar portable a un cliente nativo", () => {
    const FORBIDDEN =
      /from\s+["'](next(\/.*)?|react|react-dom|@prisma\/client|@\/(server|app|lib|components|env))["']/;

    it("no importa Next, React, Prisma ni nada de src/server", () => {
      const offenders = filesUnder("shared/")
        .filter((f) => FORBIDDEN.test(f.content))
        .map((f) => f.path);

      expect(offenders).toEqual([]);
    });
  });

  describe("el scope por Space no se puede eludir", () => {
    it("solo src/server/db/client.ts instancia PrismaClient", () => {
      const offenders = sourceFiles
        .filter(
          (f) =>
            /new\s+PrismaClient\s*\(/.test(f.content) &&
            f.path !== "server/db/client.ts",
        )
        .map((f) => f.path);

      expect(offenders).toEqual([]);
    });

    it("el SQL crudo vive solo en src/server/db/raw/", () => {
      const offenders = sourceFiles
        .filter(
          (f) =>
            /\$(queryRaw|executeRaw|queryRawUnsafe|executeRawUnsafe)/.test(
              f.content,
            ) &&
            !f.path.startsWith("server/db/raw/") &&
            !f.path.startsWith("tests/"),
        )
        .map((f) => f.path);

      expect(offenders).toEqual([]);
    });
  });

  describe("configuración", () => {
    it("process.env solo se lee en los puntos de entrada del proceso", () => {
      const ALLOWED = new Set([
        "env.ts",
        "instrumentation.ts",
        "middleware.ts",
        /**
         * Contraparte pública de env.ts. El código de cliente no puede
         * importar `env` (es server-only, valida secretos con Zod), así que
         * este es su único acceso autorizado a process.env — y lo que exponga
         * termina en el bundle que baja cualquiera, nunca puede ser secreto.
         */
        "shared/config.ts",
      ]);

      const offenders = sourceFiles
        .filter(
          (f) =>
            f.content.includes("process.env") &&
            !ALLOWED.has(f.path) &&
            !f.path.startsWith("tests/"),
        )
        .map((f) => f.path);

      expect(offenders).toEqual([]);
    });
  });
});
