// Prisma 7 ya no carga los .env por su cuenta: hay que hacerlo explícito.
import "dotenv/config";

import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    /**
     * Se lee directo de process.env en vez de con el helper `env()` de Prisma
     * porque ese helper es eager y tira si la variable falta.
     *
     * `prisma generate` es pura generación de código y no necesita conexión:
     * el build de Docker, que por diseño no tiene secretos, fallaría sin esto.
     * Los comandos que sí la necesitan (migrate, studio) avisan igual si está
     * vacía.
     */
    url: process.env.DATABASE_URL ?? "",
  },
});
