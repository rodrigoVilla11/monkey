import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  GLOBAL_MODELS,
  SELF_SCOPED_MODEL,
  SOFT_DELETE_MODELS,
  SPACE_SCOPED_MODELS,
  SYSTEM_ONLY_MODELS,
} from "@/server/db/models";

/**
 * La extensión de scope se apoya en unas listas de modelos escritas a mano en
 * `db/models.ts`. Si alguien agrega un modelo al esquema y se olvida de
 * clasificarlo, ese modelo quedaría fuera del filtro por Space.
 *
 * Este test lee schema.prisma y verifica que la clasificación coincida con la
 * realidad. Es la red que impide que esas listas se pudran.
 */

const SCHEMA = readFileSync(
  resolve(import.meta.dirname, "../../../prisma/schema.prisma"),
  "utf8",
);

interface ParsedModel {
  readonly name: string;
  readonly fields: readonly string[];
}

const parseModels = (schema: string): ParsedModel[] => {
  const models: ParsedModel[] = [];
  const modelRe = /^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm;

  let match: RegExpExecArray | null;
  while ((match = modelRe.exec(schema)) !== null) {
    const [, name = "", body = ""] = match;
    const fields = body
      .split("\n")
      .map((line) => line.trim())
      .filter(
        (line) => line !== "" && !line.startsWith("/") && !line.startsWith("@"),
      )
      .map((line) => line.split(/\s+/)[0] ?? "")
      .filter((field) => field !== "");

    models.push({ name, fields });
  }

  return models;
};

const models = parseModels(SCHEMA);
const byName = new Map(models.map((m) => [m.name, m]));

const classified = new Set<string>([
  ...SPACE_SCOPED_MODELS,
  ...GLOBAL_MODELS,
  ...SYSTEM_ONLY_MODELS,
  SELF_SCOPED_MODEL,
]);

describe("clasificación de modelos para el scope por Space", () => {
  it("parsea el esquema", () => {
    expect(models.length).toBeGreaterThan(15);
    expect(byName.has("Transaction")).toBe(true);
  });

  it("clasifica TODOS los modelos del esquema", () => {
    // Si esto falla, agregaste un modelo y no lo clasificaste en db/models.ts.
    // La extensión tira ante un modelo desconocido, así que el fallo sería en
    // runtime; mejor que sea acá.
    const unclassified = models
      .map((m) => m.name)
      .filter((name) => !classified.has(name));

    expect(unclassified).toEqual([]);
  });

  it("no clasifica modelos que ya no existen", () => {
    const ghosts = [...classified].filter((name) => !byName.has(name));
    expect(ghosts).toEqual([]);
  });

  it("marca como scopeado exactamente lo que tiene columna spaceId", () => {
    const withSpaceId = models
      .filter((m) => m.fields.includes("spaceId"))
      .map((m) => m.name)
      .sort();

    expect([...SPACE_SCOPED_MODELS].sort()).toEqual(withSpaceId);
  });

  it("no deja ningún modelo con spaceId fuera del scope", () => {
    const leaking = models.filter(
      (m) =>
        m.fields.includes("spaceId") &&
        !new Set<string>(SPACE_SCOPED_MODELS).has(m.name),
    );

    expect(leaking.map((m) => m.name)).toEqual([]);
  });

  it("los modelos globales y de sistema no tienen spaceId", () => {
    for (const name of [...GLOBAL_MODELS, ...SYSTEM_ONLY_MODELS]) {
      expect(byName.get(name)?.fields).not.toContain("spaceId");
    }
  });

  it("Space se auto-scopea por su propia PK", () => {
    const space = byName.get(SELF_SCOPED_MODEL);
    expect(space?.fields).toContain("id");
    expect(space?.fields).not.toContain("spaceId");
  });

  it("marca como borrado lógico exactamente lo que tiene deletedAt", () => {
    const withDeletedAt = models
      .filter((m) => m.fields.includes("deletedAt"))
      .map((m) => m.name)
      .sort();

    expect([...SOFT_DELETE_MODELS].sort()).toEqual(withDeletedAt);
  });
});

describe("integridad referencial dentro del Space", () => {
  /**
   * Toda relación entre dos modelos scopeados tiene que usar clave foránea
   * compuesta (spaceId, id). Sin eso, un service con un bug podría enlazar
   * una fila del Space A con una del Space B y la extensión no lo vería.
   */
  const scoped = new Set<string>(SPACE_SCOPED_MODELS);

  const relationLines = SCHEMA.split("\n")
    .map((line) => line.trim())
    .filter((line) => line.includes("@relation(fields:"));

  it("encuentra relaciones para analizar", () => {
    expect(relationLines.length).toBeGreaterThan(10);
  });

  it("toda relación entre modelos scopeados usa FK compuesta con spaceId", () => {
    const offenders = relationLines.filter((line) => {
      // Forma: `campo  Tipo?  @relation(... fields: [...], references: [...])`
      const target = line.split(/\s+/)[1]?.replace(/[?[\]]/g, "") ?? "";
      if (!scoped.has(target)) return false;

      const fields = /fields:\s*\[([^\]]*)\]/.exec(line)?.[1] ?? "";
      return !fields.includes("spaceId");
    });

    expect(offenders).toEqual([]);
  });

  it("las FK compuestas no usan SetNull, que anularía también el spaceId", () => {
    // Postgres anula TODAS las columnas de la FK: spaceId es NOT NULL, así que
    // un SetNull compuesto reventaría en runtime al borrar el padre.
    const offenders = relationLines.filter((line) => {
      const fields = /fields:\s*\[([^\]]*)\]/.exec(line)?.[1] ?? "";
      return fields.includes("spaceId") && line.includes("SetNull");
    });

    expect(offenders).toEqual([]);
  });
});
