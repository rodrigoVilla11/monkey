/**
 * Clasificación de los modelos según cómo se los puede tocar desde un cliente
 * scopeado por Space.
 *
 * Estas listas son la fuente de verdad de la extensión de scope. Se mantienen
 * a mano, pero NO pueden desincronizarse del esquema sin que falle
 * `src/tests/arch/db-scope-coverage.test.ts`, que lee schema.prisma y verifica
 * que cada modelo esté clasificado y que la clasificación coincida con sus
 * campos reales.
 */

/**
 * Modelos con columna `spaceId`. Toda operación sobre ellos a través de un
 * cliente scopeado lleva el filtro inyectado.
 */
export const SPACE_SCOPED_MODELS = [
  "Membership",
  "Invitation",
  "AuditLog",
  "Account",
  "Category",
  "Transaction",
  "Tag",
  "TransactionTag",
  "Budget",
  "RecurringRule",
  "SavingsGoal",
  "SavingsContribution",
  "Debt",
  "DebtPayment",
  "Attachment",
] as const;

/**
 * `Space` no tiene `spaceId`: su propia PK ES el scope. La extensión inyecta
 * `id: spaceId` para que un cliente scopeado solo pueda ver y editar su Space.
 */
export const SELF_SCOPED_MODEL = "Space";

/**
 * Global de verdad: las cotizaciones no pertenecen a nadie. Se puede leer y
 * escribir desde un cliente scopeado sin filtro.
 */
export const GLOBAL_MODELS = ["ExchangeRate"] as const;

/**
 * Accesibles SOLO con `systemClient()`. Son datos de identidad que cruzan
 * Spaces por naturaleza: un cliente scopeado que los tocara estaría, por
 * definición, saliéndose de su Space.
 *
 * Los datos del usuario que sí hacen falta dentro de un Space (nombre y avatar
 * de los miembros) se leen con un `include` desde Membership, que sí está
 * scopeado.
 */
export const SYSTEM_ONLY_MODELS = [
  "User",
  "RefreshToken",
  "VerificationToken",
] as const;

/**
 * Modelos con borrado lógico. La extensión les agrega `deletedAt: null` a las
 * lecturas, salvo que se pida explícitamente lo contrario.
 */
export const SOFT_DELETE_MODELS = [
  "Space",
  "User",
  "Account",
  "Category",
  "Transaction",
  "Tag",
  "Budget",
  "RecurringRule",
  "SavingsGoal",
  "Debt",
  "Attachment",
] as const;

export type SpaceScopedModel = (typeof SPACE_SCOPED_MODELS)[number];

const spaceScoped: ReadonlySet<string> = new Set(SPACE_SCOPED_MODELS);
const global: ReadonlySet<string> = new Set(GLOBAL_MODELS);
const systemOnly: ReadonlySet<string> = new Set(SYSTEM_ONLY_MODELS);
const softDelete: ReadonlySet<string> = new Set(SOFT_DELETE_MODELS);

export const isSpaceScoped = (model: string): boolean => spaceScoped.has(model);
export const isSelfScoped = (model: string): boolean =>
  model === SELF_SCOPED_MODEL;
export const isGlobal = (model: string): boolean => global.has(model);
export const isSystemOnly = (model: string): boolean => systemOnly.has(model);
export const hasSoftDelete = (model: string): boolean => softDelete.has(model);
