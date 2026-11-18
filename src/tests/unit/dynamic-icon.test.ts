import { Circle, icons } from "lucide-react";
import { describe, expect, it } from "vitest";

import { isKnownIcon, resolveIcon } from "@/components/ui/dynamic-icon";
import { getDefaultCategories } from "@/shared/default-categories";
import { CATEGORY_ICON_CHOICES } from "@/shared/icon-catalog";

/**
 * Los íconos se guardan por nombre y se resuelven al renderizar. Si la
 * resolución falla, no hay error: sale un círculo gris en toda la app. Esto
 * es lo que pasó cuando el componente comprobaba `typeof === "function"`
 * sobre objetos `forwardRef`. Estos tests son la alarma.
 */

describe("resolveIcon", () => {
  it("encuentra un ícono por su nombre canónico", () => {
    expect(resolveIcon("Wallet")).toBe(icons.Wallet);
    expect(resolveIcon("Wallet")).not.toBe(Circle);
  });

  it("acepta los alias viejos de lucide", () => {
    // `PlusCircle` pasó a llamarse `CirclePlus`; una categoría creada con el
    // nombre viejo tiene que seguir mostrando el mismo dibujo.
    expect(resolveIcon("PlusCircle")).toBe(icons.CirclePlus);
  });

  it("cae en el genérico con nombres inventados, vacíos o nulos", () => {
    expect(resolveIcon("NoExiste")).toBe(Circle);
    expect(resolveIcon("")).toBe(Circle);
    expect(resolveIcon(null)).toBe(Circle);
    expect(resolveIcon(undefined)).toBe(Circle);
  });

  it("no renderiza utilidades del paquete aunque se llamen como un ícono", () => {
    expect(resolveIcon("createLucideIcon")).toBe(Circle);
    expect(resolveIcon("icons")).toBe(Circle);
  });

  it("isKnownIcon distingue el genérico elegido a propósito", () => {
    expect(isKnownIcon("Circle")).toBe(true);
    expect(isKnownIcon("Wallet")).toBe(true);
    expect(isKnownIcon("NoExiste")).toBe(false);
  });
});

describe("catálogos de la app", () => {
  it("todos los íconos del selector existen en la versión instalada de lucide", () => {
    const missing = CATEGORY_ICON_CHOICES.filter((name) => !isKnownIcon(name));
    expect(missing).toEqual([]);
  });

  it("todas las categorías por defecto tienen un ícono real", () => {
    const set = getDefaultCategories("es-ES");
    const names = [...set.income, ...set.expense].flatMap((category) => [
      category.icon,
      ...(category.children ?? []).map((child) => child.icon),
    ]);

    expect(names.length).toBeGreaterThan(10);
    expect(names.filter((name) => !isKnownIcon(name))).toEqual([]);
  });
});
