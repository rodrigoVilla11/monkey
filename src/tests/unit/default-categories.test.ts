import { describe, expect, it } from "vitest";

import {
  countDefaultCategories,
  getDefaultCategories,
} from "@/shared/default-categories";

describe("catálogo de categorías por defecto", () => {
  const set = getDefaultCategories("es-ES");

  it("trae ingresos y gastos", () => {
    expect(set.income.length).toBeGreaterThan(0);
    expect(set.expense.length).toBeGreaterThan(0);
  });

  it("resuelve por idioma, ignorando la región", () => {
    // Un español y un argentino tienen que arrancar con el mismo catálogo.
    expect(getDefaultCategories("es-AR")).toEqual(
      getDefaultCategories("es-ES"),
    );
    expect(getDefaultCategories("es")).toEqual(getDefaultCategories("es-ES"));
  });

  it("cae en español ante un idioma que no existe todavía", () => {
    expect(getDefaultCategories("en-US")).toEqual(
      getDefaultCategories("es-ES"),
    );
    expect(getDefaultCategories("")).toEqual(getDefaultCategories("es-ES"));
  });

  it("respeta el máximo de 2 niveles del modelo", () => {
    for (const category of [...set.income, ...set.expense]) {
      for (const child of category.children ?? []) {
        expect(child).not.toHaveProperty("children");
      }
    }
  });

  it("no repite nombres dentro del mismo tipo", () => {
    for (const group of [set.income, set.expense]) {
      const names = group.flatMap((c) => [
        c.name,
        ...(c.children ?? []).map((child) => child.name),
      ]);
      expect(new Set(names).size).toBe(names.length);
    }
  });

  it("da a cada categoría ícono y color", () => {
    for (const category of [...set.income, ...set.expense]) {
      for (const node of [category, ...(category.children ?? [])]) {
        expect(node.name.trim()).not.toBe("");
        expect(node.icon.trim()).not.toBe("");
        expect(node.color).toMatch(/^#[0-9a-f]{6}$/i);
      }
    }
  });

  it("cuenta el total incluyendo las de segundo nivel", () => {
    const manual = [...set.income, ...set.expense].reduce(
      (total, c) => total + 1 + (c.children?.length ?? 0),
      0,
    );
    expect(countDefaultCategories(set)).toBe(manual);
    expect(countDefaultCategories(set)).toBeGreaterThan(30);
  });
});
