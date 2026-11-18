import * as Lucide from "lucide-react";
import { Circle, icons, type LucideIcon } from "lucide-react";
import { createElement } from "react";

/**
 * Ícono resuelto por nombre en tiempo de ejecución.
 *
 * Las categorías y cuentas guardan el NOMBRE del ícono ("ShoppingCart"), no el
 * componente, porque el catálogo es dato editable por el usuario.
 *
 * ── Dónde se busca ──────────────────────────────────────────────────────────
 *
 * Primero en `icons`, el mapa oficial de lucide con los nombres canónicos.
 * Después en el namespace del paquete, que además exporta los ALIAS viejos
 * (`PlusCircle` por `CirclePlus`): una categoría creada con una versión
 * anterior de lucide tiene que seguir mostrando su ícono.
 *
 * Un ícono de lucide es un objeto `forwardRef`, no una función. Comprobar
 * `typeof === "function"` —lo que hacía esto antes— no reconocía ninguno y
 * TODOS los íconos de la app salían como el círculo genérico. Por eso ahora se
 * reconoce por `$$typeof`, que es lo que identifica a un componente de React
 * sea función, forwardRef o memo.
 *
 * Se usa `createElement` y no `const Icon = ...; <Icon />` a propósito:
 * asignar un componente a una variable durante el render hace que React lo
 * trate como un tipo nuevo en cada pasada y remonte el subárbol, perdiendo su
 * estado. Con un ícono sin estado el efecto es invisible, pero es un patrón
 * que se copia — y el linter de React lo marca, con razón.
 *
 * Si el nombre no existe (un ícono inventado a mano, o uno que lucide borró),
 * cae en uno genérico en vez de romper el render.
 */

const CANONICAL = icons as unknown as Record<string, LucideIcon | undefined>;
const NAMESPACE = Lucide as unknown as Record<string, unknown>;

/**
 * Un ícono de lucide es un `forwardRef`: un objeto con `$$typeof`. Las
 * funciones quedan fuera a propósito: el namespace también exporta utilidades
 * como `createLucideIcon`, y renderizarlas como componente rompería la app.
 */
const isForwardRefIcon = (value: unknown): value is LucideIcon =>
  typeof value === "object" && value !== null && "$$typeof" in value;

/** El componente para un nombre guardado, o el genérico si no hay ninguno. */
export const resolveIcon = (name: string | null | undefined): LucideIcon => {
  if (name == null || name === "") return Circle;

  const canonical = CANONICAL[name];
  if (canonical !== undefined) return canonical;

  const alias = NAMESPACE[name];
  return isForwardRefIcon(alias) ? alias : Circle;
};

/** ¿Hay un ícono de lucide con este nombre (canónico o alias)? */
export const isKnownIcon = (name: string): boolean =>
  resolveIcon(name) !== Circle || name === "Circle";

export function DynamicIcon({
  name,
  className,
  style,
}: {
  name: string | null | undefined;
  className?: string;
  style?: React.CSSProperties;
}) {
  return createElement(resolveIcon(name), { className, style });
}
