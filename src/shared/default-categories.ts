/**
 * Catálogo de categorías que se siembra al crear un Space.
 *
 * Es solo un punto de partida: quedan marcadas con `isSystem` para poder
 * distinguirlas en la UI, pero se pueden renombrar, recolorear y borrar como
 * cualquier otra.
 *
 * Dos niveles como máximo, igual que el modelo. Los íconos son nombres de
 * lucide-react.
 *
 * Módulo puro: no importa Prisma. El service de categorías lo traduce a filas.
 */

export type CategoryKindLiteral = "INCOME" | "EXPENSE";

export interface DefaultCategory {
  readonly name: string;
  readonly icon: string;
  readonly color: string;
  readonly children?: readonly Omit<DefaultCategory, "children">[];
}

export interface DefaultCategorySet {
  readonly income: readonly DefaultCategory[];
  readonly expense: readonly DefaultCategory[];
}

const es: DefaultCategorySet = {
  income: [
    { name: "Salario", icon: "Wallet", color: "#22c55e" },
    { name: "Autónomo", icon: "Briefcase", color: "#10b981" },
    { name: "Inversiones", icon: "TrendingUp", color: "#14b8a6" },
    { name: "Alquileres", icon: "Building2", color: "#0ea5e9" },
    { name: "Regalos", icon: "Gift", color: "#a855f7" },
    { name: "Reembolsos", icon: "Undo2", color: "#64748b" },
    { name: "Otros ingresos", icon: "CirclePlus", color: "#94a3b8" },
  ],
  expense: [
    {
      name: "Alimentación",
      icon: "ShoppingCart",
      color: "#f59e0b",
      children: [
        { name: "Supermercado", icon: "ShoppingBasket", color: "#f59e0b" },
        { name: "Restaurantes", icon: "UtensilsCrossed", color: "#f97316" },
        { name: "Cafetería", icon: "Coffee", color: "#d97706" },
      ],
    },
    {
      name: "Vivienda",
      icon: "House",
      color: "#3b82f6",
      children: [
        { name: "Alquiler o hipoteca", icon: "KeyRound", color: "#3b82f6" },
        { name: "Luz y gas", icon: "Zap", color: "#eab308" },
        { name: "Agua", icon: "Droplet", color: "#06b6d4" },
        { name: "Internet y teléfono", icon: "Wifi", color: "#6366f1" },
        { name: "Mantenimiento", icon: "Hammer", color: "#78716c" },
      ],
    },
    {
      name: "Transporte",
      icon: "Car",
      color: "#8b5cf6",
      children: [
        { name: "Combustible", icon: "Fuel", color: "#8b5cf6" },
        { name: "Transporte público", icon: "TramFront", color: "#7c3aed" },
        { name: "Taxi y VTC", icon: "CarTaxiFront", color: "#a78bfa" },
        { name: "Seguro y mantenimiento", icon: "Wrench", color: "#6d28d9" },
      ],
    },
    {
      name: "Salud",
      icon: "HeartPulse",
      color: "#ef4444",
      children: [
        { name: "Farmacia", icon: "Pill", color: "#ef4444" },
        { name: "Médico y dentista", icon: "Stethoscope", color: "#dc2626" },
        { name: "Seguro médico", icon: "ShieldPlus", color: "#b91c1c" },
      ],
    },
    {
      name: "Ocio",
      icon: "PartyPopper",
      color: "#ec4899",
      children: [
        { name: "Suscripciones", icon: "MonitorPlay", color: "#ec4899" },
        { name: "Salidas", icon: "Beer", color: "#db2777" },
        { name: "Viajes", icon: "Plane", color: "#f472b6" },
        { name: "Deporte", icon: "Dumbbell", color: "#be185d" },
      ],
    },
    {
      name: "Compras",
      icon: "ShoppingBag",
      color: "#06b6d4",
      children: [
        { name: "Ropa", icon: "Shirt", color: "#06b6d4" },
        { name: "Tecnología", icon: "Smartphone", color: "#0891b2" },
        { name: "Hogar", icon: "Lamp", color: "#0e7490" },
      ],
    },
    {
      name: "Educación",
      icon: "GraduationCap",
      color: "#84cc16",
      children: [
        { name: "Cursos", icon: "BookOpen", color: "#84cc16" },
        { name: "Libros", icon: "Book", color: "#65a30d" },
      ],
    },
    {
      name: "Finanzas",
      icon: "Landmark",
      color: "#64748b",
      children: [
        { name: "Comisiones bancarias", icon: "Receipt", color: "#64748b" },
        { name: "Impuestos", icon: "FileText", color: "#475569" },
        { name: "Intereses", icon: "Percent", color: "#334155" },
      ],
    },
    { name: "Mascotas", icon: "PawPrint", color: "#a16207" },
    { name: "Regalos y donaciones", icon: "HandHeart", color: "#f43f5e" },
    { name: "Otros gastos", icon: "CircleEllipsis", color: "#94a3b8" },
  ],
};

/**
 * Resuelto por idioma, con fallback a español.
 *
 * Solo existe `es` porque es el único idioma de la app hoy. La firma acepta
 * cualquier locale para que sumar otro sea agregar un objeto acá, sin tocar
 * el service que lo consume.
 */
const SETS: Readonly<Record<string, DefaultCategorySet>> = { es };

export const getDefaultCategories = (locale: string): DefaultCategorySet => {
  const language = locale.split("-")[0]?.toLowerCase() ?? "es";
  return SETS[language] ?? es;
};

/** Cuántas categorías crea la seed en total, contando las de segundo nivel. */
export const countDefaultCategories = (set: DefaultCategorySet): number =>
  [...set.income, ...set.expense].reduce(
    (total, category) => total + 1 + (category.children?.length ?? 0),
    0,
  );
