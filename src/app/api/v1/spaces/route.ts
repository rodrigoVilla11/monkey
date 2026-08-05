import { route } from "@/server/api/handler";
import { json } from "@/server/api/responses";
import { createSpace, listSpaces } from "@/server/services/spaces/spaces";
import {
  createSpaceRequestSchema,
  type CreateSpaceRequest,
} from "@/shared/contracts/spaces";

export const runtime = "nodejs";

/**
 * GET /api/v1/spaces
 *
 * Los Spaces del usuario con su rol en cada uno. Alimenta el selector del
 * header. No lleva `space` porque no está acotado a uno: es la lista.
 */
export const GET = route({ auth: true, verified: true }, async ({ session }) =>
  json({ spaces: await listSpaces(session.userId) }),
);

/**
 * POST /api/v1/spaces
 *
 * Crea un Space compartido (los personales los crea el registro). Quien lo
 * crea queda como OWNER y se siembra el catálogo de categorías en su idioma.
 */
export const POST = route<CreateSpaceRequest>(
  { body: createSpaceRequestSchema, auth: true, verified: true },
  async ({ body, session, logger }) => {
    const space = await createSpace(session.userId, session.name, body);
    logger.info({ spaceId: space.id }, "espacio creado");
    return json({ space }, { status: 201 });
  },
);
