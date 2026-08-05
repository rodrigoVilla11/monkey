import { execSync } from "node:child_process";

/**
 * Corre una sola vez antes de toda la suite de integración: aplica las
 * migraciones a la base de tests.
 *
 * Se usa `migrate deploy` y no `db push` a propósito. Así los tests se
 * ejecutan contra el MISMO SQL que va a producción, incluidos los CHECK y los
 * índices únicos parciales que Prisma no expresa en el esquema. Con `db push`
 * esos constraints no existirían y los tests pasarían en verde sobre una base
 * que no se parece a la real.
 */
export default function setup(): void {
  const databaseUrl = process.env.DATABASE_URL;

  if (databaseUrl === undefined || databaseUrl === "") {
    throw new Error(
      "Falta DATABASE_URL para los tests de integración. " +
        "Levantá los servicios con `pnpm docker:up`.",
    );
  }

  if (!databaseUrl.includes("_test")) {
    // Red de seguridad: `migrate deploy` sobre la base de desarrollo sería
    // molesto, pero apuntar a producción sería catastrófico.
    throw new Error(
      `Los tests de integración se niegan a correr contra una base que no ` +
        `sea de test. DATABASE_URL apunta a: ${databaseUrl.replace(/:[^:@]*@/, ":***@")}`,
    );
  }

  // Comando literal, sin argumentos interpolados: evita el DEP0190 de pasar
  // args por shell, y no hay nada que escapar.
  execSync("pnpm prisma migrate deploy", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: databaseUrl },
  });
}
