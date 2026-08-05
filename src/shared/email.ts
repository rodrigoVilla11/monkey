/**
 * Normalización de emails.
 *
 * Toda la app guarda los emails en minúsculas y sin espacios. Eso da la
 * unicidad case-insensitive que pide el brief sin necesitar la extensión
 * `citext` de Postgres, y evita que "Ana@x.com" y "ana@x.com" sean dos cuentas.
 *
 * Hay un CHECK en la base que lo hace cumplir aunque algún camino de código se
 * olvide de llamar a esta función.
 */
export const normalizeEmail = (email: string): string =>
  email.trim().toLowerCase();

/**
 * Oculta un email para poder loguearlo sin exponer datos personales.
 * "rodrigo@ejemplo.com" → "r***o@ejemplo.com"
 */
export const maskEmail = (email: string): string => {
  const [local = "", domain = ""] = email.split("@");
  if (domain === "") return "***";
  if (local.length <= 2) return `***@${domain}`;
  return `${local[0] ?? ""}***${local.at(-1) ?? ""}@${domain}`;
};
