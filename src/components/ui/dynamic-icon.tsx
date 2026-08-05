import * as Icons from "lucide-react";
import { createElement } from "react";

/**
 * Ícono resuelto por nombre en tiempo de ejecución.
 *
 * Las categorías y cuentas guardan el NOMBRE del ícono ("ShoppingCart"), no el
 * componente, porque el catálogo es dato editable por el usuario.
 *
 * Se usa `createElement` y no `const Icon = ...; <Icon />` a propósito:
 * asignar un componente a una variable durante el render hace que React lo
 * trate como un tipo nuevo en cada pasada y remonte el subárbol, perdiendo su
 * estado. Con un ícono sin estado el efecto es invisible, pero es un patrón
 * que se copia — y el linter de React lo marca, con razón.
 *
 * Si el nombre guardado no existe (una categoría creada a mano con un ícono
 * inventado, o un ícono que lucide renombró), cae en uno genérico en vez de
 * romper el render.
 */
const CATALOG = Icons as unknown as Record<string, unknown>;

export function DynamicIcon({
  name,
  className,
  style,
}: {
  name: string | null | undefined;
  className?: string;
  style?: React.CSSProperties;
}) {
  const candidate = name == null ? undefined : CATALOG[name];
  const component =
    typeof candidate === "function"
      ? (candidate as Icons.LucideIcon)
      : Icons.Circle;

  return createElement(component, { className, style });
}
