import { PrismaPg } from "@prisma/adapter-pg";

import { env } from "@/env";
import { PrismaClient } from "@/generated/prisma/client";

/**
 * El PrismaClient SIN scope.
 *
 * ⚠️ Este es el único archivo del proyecto autorizado a construirlo, y la
 * regla `no-restricted-imports` de ESLint impide importarlo desde fuera de
 * `src/server/db/**`. El resto del código usa:
 *
 *   · `forSpace(spaceId)` — para todo lo que sea dominio financiero
 *   · `systemClient()`    — para lo que legítimamente cruza Spaces (auth,
 *                           registro, el job de recurrentes)
 *
 * En Prisma 7 ya no hay engine de Rust: la conexión va por un driver adapter
 * sobre `pg`.
 */

const createClient = (): PrismaClient => {
  const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });

  return new PrismaClient({
    adapter,
    log: env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
};

/**
 * En desarrollo, el hot reload de Next reevalúa los módulos y dejaría una
 * conexión nueva por recarga hasta agotar el pool de Postgres. El singleton
 * vive en globalThis para sobrevivir a eso.
 */
const globalForPrisma = globalThis as unknown as {
  monkeyPrisma?: PrismaClient;
};

export const prisma: PrismaClient =
  globalForPrisma.monkeyPrisma ?? createClient();

if (env.NODE_ENV !== "production") {
  globalForPrisma.monkeyPrisma = prisma;
}

export type { PrismaClient };
