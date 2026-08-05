import { z } from "zod";

import { route } from "@/server/api/handler";
import { json } from "@/server/api/responses";
import type { AuditLogEntry } from "@/shared/contracts/spaces";

export const runtime = "nodejs";

const paramsSchema = z.object({
  spaceId: z.string().min(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().optional(),
});
type Params = z.infer<typeof paramsSchema>;

/**
 * GET /api/v1/spaces/:spaceId/audit-logs
 *
 * Historial de cambios de miembros, invitaciones y borrados. ADMIN o superior:
 * expone quién hizo qué, que no es información para un VIEWER.
 *
 * Paginado por cursor y no por offset: el historial crece por el principio, y
 * con offset una entrada nueva desplaza toda la página.
 */
export const GET = route<undefined, Params>(
  { params: paramsSchema, space: { minRole: "ADMIN" } },
  async ({ params, db }) => {
    const rows = await db.auditLog.findMany({
      take: params.limit + 1,
      ...(params.cursor !== undefined
        ? { cursor: { id: params.cursor }, skip: 1 }
        : {}),
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        action: true,
        entityType: true,
        entityId: true,
        actorName: true,
        metadata: true,
        createdAt: true,
      },
    });

    // Se pide uno de más para saber si hay página siguiente sin un count.
    const hasMore = rows.length > params.limit;
    const page = hasMore ? rows.slice(0, params.limit) : rows;

    const entries: AuditLogEntry[] = page.map((row) => ({
      id: row.id,
      action: row.action,
      entityType: row.entityType,
      entityId: row.entityId,
      actorName: row.actorName,
      metadata: row.metadata,
      createdAt: row.createdAt.toISOString(),
    }));

    return json({
      entries,
      nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null,
    });
  },
);
