import { z } from "zod";

import { errors } from "@/server/api/errors";
import { route } from "@/server/api/handler";
import { json } from "@/server/api/responses";
import {
  createTagRequestSchema,
  type CreateTagRequest,
  type TagDTO,
} from "@/shared/contracts/transactions";

export const runtime = "nodejs";

const paramsSchema = z.object({ spaceId: z.string().min(1) });
type Params = z.infer<typeof paramsSchema>;

export const GET = route<undefined, Params>(
  { params: paramsSchema, space: { minRole: "VIEWER" } },
  async ({ db }) => {
    const rows = await db.tag.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        color: true,
        _count: { select: { transactions: true } },
      },
    });

    const tags: TagDTO[] = rows.map((row) => ({
      id: row.id,
      name: row.name,
      color: row.color,
      transactionCount: row._count.transactions,
    }));

    return json({ tags });
  },
);

export const POST = route<CreateTagRequest, Params>(
  {
    body: createTagRequestSchema,
    params: paramsSchema,
    space: { minRole: "MEMBER" },
  },
  async ({ body, access, db }) => {
    // Hay un índice único parcial (spaceId, name) sobre los no borrados. Se
    // chequea antes para responder 409 con un mensaje claro en vez de dejar
    // que salga el error crudo de Postgres.
    const existing = await db.tag.findFirst({
      where: { name: body.name },
      select: { id: true },
    });

    if (existing !== null) {
      throw errors.conflict(
        "CONFLICT",
        "Ya existe una etiqueta con ese nombre",
      );
    }

    const tag = await db.tag.create({
      data: {
        spaceId: access.spaceId,
        name: body.name,
        color: body.color ?? null,
      },
      select: { id: true, name: true, color: true },
    });

    return json({ tag }, { status: 201 });
  },
);
