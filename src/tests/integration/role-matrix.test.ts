import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { requireSpaceAccess } from "@/server/api/authorize";
import { SPACE_SCOPED_ROUTES, routeKey } from "@/server/api/routes.manifest";
import {
  MEMBERSHIP_ROLES,
  hasAtLeast,
  type MembershipRole,
} from "@/shared/roles";

import { disconnect, resetDatabase, testDb } from "./helpers/db";

/**
 * Matriz de permisos: CADA endpoint acotado a Space × CADA rol.
 *
 * El recorrido sale de `routes.manifest.ts`, no de una lista escrita a mano.
 * Sumado a `routes-manifest.test.ts` —que falla si un endpoint no está
 * declarado— esto significa que un endpoint nuevo entra automáticamente en la
 * matriz. Es lo que evita que se pudra.
 *
 * Se ejercita `requireSpaceAccess`, que es exactamente la decisión de
 * autorización que toma `route()` antes de llegar al handler.
 */

interface Actors {
  readonly spaceId: string;
  readonly byRole: Record<MembershipRole, string>;
  readonly outsiderId: string;
  readonly otherSpaceId: string;
}

let actors: Actors;

beforeAll(async () => {
  await resetDatabase();

  const makeUser = async (label: string): Promise<string> => {
    const user = await testDb.user.create({
      data: {
        email: `${label}@matriz.test`,
        passwordHash: "hash",
        name: label,
        timezone: "Europe/Madrid",
        locale: "es-ES",
        emailVerifiedAt: new Date(),
      },
    });
    return user.id;
  };

  const ownerId = await makeUser("owner");
  const adminId = await makeUser("admin");
  const memberId = await makeUser("member");
  const viewerId = await makeUser("viewer");
  const outsiderId = await makeUser("outsider");

  const space = await testDb.space.create({
    data: {
      name: "Casa compartida",
      primaryCurrency: "EUR",
      timezone: "Europe/Madrid",
      memberships: {
        create: [
          { userId: ownerId, role: "OWNER" },
          { userId: adminId, role: "ADMIN" },
          { userId: memberId, role: "MEMBER" },
          { userId: viewerId, role: "VIEWER" },
        ],
      },
    },
  });

  const other = await testDb.space.create({
    data: {
      name: "Space ajeno",
      primaryCurrency: "EUR",
      timezone: "Europe/Madrid",
      memberships: { create: { userId: outsiderId, role: "OWNER" } },
    },
  });

  actors = {
    spaceId: space.id,
    byRole: {
      OWNER: ownerId,
      ADMIN: adminId,
      MEMBER: memberId,
      VIEWER: viewerId,
    },
    outsiderId,
    otherSpaceId: other.id,
  };
});

afterAll(async () => {
  await resetDatabase();
  await disconnect();
});

describe("matriz de permisos por rol", () => {
  it("el manifiesto declara endpoints acotados a Space", () => {
    expect(SPACE_SCOPED_ROUTES.length).toBeGreaterThan(8);
  });

  // Un `describe` por endpoint, un `it` por rol. Si algo falla, el nombre del
  // test dice exactamente qué endpoint y qué rol.
  for (const spec of SPACE_SCOPED_ROUTES) {
    describe(routeKey(spec), () => {
      for (const role of MEMBERSHIP_ROLES) {
        const shouldPass = hasAtLeast(role, spec.minRole);

        it(`${role} → ${shouldPass ? "permitido" : "403 INSUFFICIENT_ROLE"}`, async () => {
          const userId = actors.byRole[role];
          const attempt = requireSpaceAccess(
            userId,
            actors.spaceId,
            spec.minRole,
          );

          if (shouldPass) {
            const access = await attempt;
            expect(access.role).toBe(role);
            expect(access.spaceId).toBe(actors.spaceId);
            expect(access.userId).toBe(userId);
          } else {
            await expect(attempt).rejects.toMatchObject({
              code: "INSUFFICIENT_ROLE",
              status: 403,
            });
          }
        });
      }

      it("quien no es miembro → 404, nunca 403", async () => {
        // 404 y no 403: un 403 confirmaría que el Space existe y permitiría
        // sondear qué IDs son reales.
        await expect(
          requireSpaceAccess(actors.outsiderId, actors.spaceId, spec.minRole),
        ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
      });
    });
  }
});

describe("bordes de la resolución de acceso", () => {
  it("un Space inexistente da 404", async () => {
    await expect(
      requireSpaceAccess(actors.byRole.OWNER, "space-que-no-existe", "VIEWER"),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("ser OWNER de un Space no da acceso a otro", async () => {
    // El outsider es OWNER de su propio Space. Eso no le sirve acá.
    await expect(
      requireSpaceAccess(actors.outsiderId, actors.spaceId, "VIEWER"),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const own = await requireSpaceAccess(
      actors.outsiderId,
      actors.otherSpaceId,
      "OWNER",
    );
    expect(own.role).toBe("OWNER");
  });

  it("un Space borrado deja de existir para sus propios miembros", async () => {
    const temp = await testDb.space.create({
      data: {
        name: "Temporal",
        primaryCurrency: "EUR",
        timezone: "Europe/Madrid",
        deletedAt: new Date(),
        memberships: { create: { userId: actors.byRole.OWNER, role: "OWNER" } },
      },
    });

    await expect(
      requireSpaceAccess(actors.byRole.OWNER, temp.id, "VIEWER"),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
