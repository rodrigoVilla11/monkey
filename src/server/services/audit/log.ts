import type { Prisma } from "@/generated/prisma/client";
import type { AuditAction } from "@/generated/prisma/enums";

/**
 * Registro de auditoría.
 *
 * Regla que importa: el registro se escribe **dentro de la misma transacción**
 * que la mutación que documenta. Si se escribiera después, un fallo entre
 * medio dejaría el cambio hecho y sin rastro — o peor, un rastro de algo que
 * al final no pasó. Por eso `writeAuditLog` recibe el cliente de transacción y
 * no lo crea por su cuenta.
 *
 * Qué NO va en `metadata`: importes, saldos, tokens ni contraseñas. El audit
 * log responde "quién hizo qué y cuándo", no "cuánto".
 */

/** Cliente de Prisma dentro de una transacción interactiva. */
export type TransactionClient = Prisma.TransactionClient;

interface AuditEntry {
  readonly spaceId: string | null;
  readonly actorUserId: string | null;
  /** Se congela: si borran al usuario, el log sigue diciendo quién fue. */
  readonly actorName: string;
  readonly action: AuditAction;
  readonly entityType: string;
  readonly entityId?: string | null;
  readonly metadata?: Prisma.InputJsonValue;
  readonly ipHash?: string | null;
}

export const writeAuditLog = async (
  tx: TransactionClient,
  entry: AuditEntry,
): Promise<void> => {
  await tx.auditLog.create({
    data: {
      spaceId: entry.spaceId,
      actorUserId: entry.actorUserId,
      actorName: entry.actorName,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      ...(entry.metadata !== undefined ? { metadata: entry.metadata } : {}),
      ipHash: entry.ipHash ?? null,
    },
  });
};
