import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { ROUTES, routeKey } from "@/server/api/routes.manifest";

/**
 * El manifiesto de rutas solo sirve si está completo.
 *
 * Este test recorre `src/app/api/**`, extrae los métodos HTTP que exporta cada
 * `route.ts` y verifica que TODOS estén declarados. Sin esto, agregar un
 * endpoint y olvidarse de registrarlo lo dejaría fuera de la matriz de roles y
 * de la prueba de aislamiento entre Spaces sin que nadie se entere.
 */

const API_DIR = resolve(import.meta.dirname, "../../app/api");
const HTTP_METHODS = ["GET", "POST", "PATCH", "PUT", "DELETE"] as const;

interface DiscoveredRoute {
  readonly method: string;
  readonly path: string;
  readonly source: string;
}

const walk = (dir: string): string[] => {
  const found: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) found.push(...walk(full));
    else if (name === "route.ts") found.push(full);
  }
  return found;
};

const discover = (): DiscoveredRoute[] => {
  const routes: DiscoveredRoute[] = [];

  for (const file of walk(API_DIR)) {
    const content = readFileSync(file, "utf8");
    const urlPath = `/api/${relative(API_DIR, file)
      .replaceAll("\\", "/")
      .replace(/\/route\.ts$/, "")}`;

    for (const method of HTTP_METHODS) {
      // Coincide con `export const GET =` y `export async function GET(`.
      const exported = new RegExp(
        `export\\s+(?:const|async\\s+function|function)\\s+${method}\\b`,
      );
      if (exported.test(content)) {
        routes.push({ method, path: urlPath, source: relative(API_DIR, file) });
      }
    }
  }

  return routes;
};

const discovered = discover();
const declared = new Set(ROUTES.map(routeKey));

describe("manifiesto de rutas", () => {
  it("encuentra los route handlers en disco", () => {
    expect(discovered.length).toBeGreaterThan(15);
  });

  it("declara TODOS los endpoints que existen", () => {
    // Si esto falla: agregaste un endpoint y no lo registraste en
    // routes.manifest.ts, así que queda fuera de la matriz de permisos.
    const missing = discovered
      .filter((r) => !declared.has(`${r.method} ${r.path}`))
      .map((r) => `${r.method} ${r.path}  (${r.source})`);

    expect(missing).toEqual([]);
  });

  it("no declara endpoints que ya no existen", () => {
    const actual = new Set(discovered.map((r) => `${r.method} ${r.path}`));
    const stale = ROUTES.map(routeKey).filter((key) => !actual.has(key));

    expect(stale).toEqual([]);
  });

  it("no repite entradas", () => {
    const keys = ROUTES.map(routeKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("todo endpoint con rol mínimo tiene [spaceId] en el path", () => {
    // El spaceId sale SIEMPRE del path, nunca del body ni de la query.
    const offenders = ROUTES.filter(
      (r) => r.minRole !== undefined && !r.path.includes("[spaceId]"),
    ).map(routeKey);

    expect(offenders).toEqual([]);
  });

  it("todo endpoint con [spaceId] declara un rol mínimo", () => {
    // Al revés: un endpoint bajo un Space sin rol declarado sería un agujero.
    const offenders = ROUTES.filter(
      (r) => r.path.includes("[spaceId]") && r.minRole === undefined,
    ).map(routeKey);

    expect(offenders).toEqual([]);
  });

  it("los endpoints de dominio exigen email verificado", () => {
    const offenders = ROUTES.filter(
      (r) => r.minRole !== undefined && r.auth !== "verified",
    ).map(routeKey);

    expect(offenders).toEqual([]);
  });

  it("los endpoints públicos que aceptan credenciales tienen rate limit", () => {
    // register, login, refresh y forgot son los que se pueden martillar.
    const sensitive = ROUTES.filter(
      (r) =>
        r.auth === "public" &&
        r.method === "POST" &&
        /(register|login|refresh|forgot)/.test(r.path),
    );

    expect(sensitive.length).toBeGreaterThan(0);
    expect(
      sensitive.filter((r) => r.rateLimited !== true).map(routeKey),
    ).toEqual([]);
  });
});
