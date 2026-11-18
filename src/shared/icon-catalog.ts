/**
 * Íconos que se ofrecen al crear o editar una categoría.
 *
 * Son nombres canónicos de lucide, agrupados por para qué suelen servir. Viven
 * en `shared/` y no en la pantalla por una razón: un test verifica que cada
 * nombre exista en la versión instalada de lucide, así una actualización que
 * renombre un ícono se nota en CI y no como un círculo gris en el selector.
 *
 * Módulo puro: sin Next, sin Prisma, sin React.
 */
export const CATEGORY_ICON_CHOICES = [
  "ShoppingCart",
  "Utensils",
  "Coffee",
  "Beer",
  "House",
  "Lamp",
  "Droplet",
  "Fuel",
  "Car",
  "Bus",
  "Plane",
  "HeartPulse",
  "Pill",
  "Dumbbell",
  "GraduationCap",
  "Book",
  "MonitorPlay",
  "PartyPopper",
  "Gift",
  "PawPrint",
  "Shirt",
  "Smartphone",
  "Wifi",
  "Hammer",
  "Briefcase",
  "Landmark",
  "Receipt",
  "Percent",
  "PiggyBank",
  "Wallet",
  "HandHeart",
  "CircleEllipsis",
] as const;

export type CategoryIconChoice = (typeof CATEGORY_ICON_CHOICES)[number];
