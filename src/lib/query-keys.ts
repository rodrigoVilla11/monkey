import type { TransactionFilters } from "@/shared/contracts/transactions";

/**
 * Claves de TanStack Query.
 *
 * Todas las del dominio arrancan con el `spaceId`. Eso hace que invalidar o
 * limpiar un Space entero sea una sola llamada, y —más importante— que al
 * cambiar de Space no quede caché del anterior colgando en pantalla.
 */
export const queryKeys = {
  me: ["me"] as const,
  sessions: ["sessions"] as const,
  spaces: ["spaces"] as const,

  space: (spaceId: string) => ["space", spaceId] as const,
  members: (spaceId: string) => ["space", spaceId, "members"] as const,
  invitations: (spaceId: string) => ["space", spaceId, "invitations"] as const,
  auditLogs: (spaceId: string) => ["space", spaceId, "audit-logs"] as const,

  accounts: (spaceId: string, includeArchived = false) =>
    ["space", spaceId, "accounts", { includeArchived }] as const,
  account: (spaceId: string, accountId: string) =>
    ["space", spaceId, "accounts", accountId] as const,

  categories: (spaceId: string, kind?: string) =>
    ["space", spaceId, "categories", kind ?? "all"] as const,

  tags: (spaceId: string) => ["space", spaceId, "tags"] as const,

  transactions: (spaceId: string, filters: TransactionFilters) =>
    ["space", spaceId, "transactions", filters] as const,
  transaction: (spaceId: string, id: string) =>
    ["space", spaceId, "transactions", id] as const,

  dashboard: (spaceId: string, month?: string) =>
    ["space", spaceId, "dashboard", month ?? "current"] as const,
} as const;

/** Todo lo que cuelga de un Space. Para invalidar de una. */
export const spaceScopeKey = (spaceId: string) => ["space", spaceId] as const;
