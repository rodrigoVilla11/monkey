import { type Env, parseEnv } from "./env.schema";

/**
 * Singleton de configuración. Valida `process.env` la primera vez que se
 * importa: si algo está mal, el proceso muere en el arranque y no a mitad de
 * un request.
 *
 * Server-only. Si un valor tiene que llegar al browser va con prefijo
 * NEXT_PUBLIC_ y se expone desde `src/shared/config.ts`, nunca desde acá.
 */
const loadEnv = (): Env => {
  // El build de Docker corre sin DATABASE_URL ni secretos. La validación real
  // pasa al arrancar el contenedor, vía instrumentation.ts.
  if (process.env.SKIP_ENV_VALIDATION === "true") {
    return process.env as unknown as Env;
  }

  const result = parseEnv(process.env);

  if (!result.ok) {
    const lines = result.errors.map((e) => `  · ${e}`).join("\n");
    // eslint-disable-next-line no-console -- fallo fatal de arranque: el logger todavía no existe
    console.error(
      `\n✖ Variables de entorno inválidas:\n${lines}\n\n  Revisá tu .env contra .env.example\n`,
    );
    throw new Error("Configuración de entorno inválida");
  }

  return result.env;
};

export const env: Env = loadEnv();
export type { Env };
