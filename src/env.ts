import { type Env, parseEnv } from "./env.schema";

/**
 * Singleton de configuración. Valida `process.env` la primera vez que se
 * importa: si algo está mal, el proceso muere en el arranque y no a mitad de
 * un request.
 *
 * Server-only. Si un valor tiene que llegar al browser va con prefijo
 * NEXT_PUBLIC_ y se expone desde `src/shared/config.ts`, nunca desde acá.
 */
/**
 * Durante `next build`, Next evalúa los módulos de cada route handler para
 * recolectar metadatos. Esos módulos importan `env` en cadena, y como el build
 * corre con NODE_ENV=production se dispararían las reglas de producción (https
 * obligatorio, driver de mail real, CRON_SECRET) sobre un entorno de build que
 * por diseño no tiene secretos.
 *
 * Next expone la fase en NEXT_PHASE, así que se detecta sola y no hace falta
 * acordarse de pasar un flag. SKIP_ENV_VALIDATION queda como escape manual
 * para el Dockerfile y para CI.
 */
const isBuildPhase = (): boolean =>
  process.env.NEXT_PHASE === "phase-production-build" ||
  process.env.SKIP_ENV_VALIDATION === "true";

const loadEnv = (): Env => {
  // La validación real pasa al arrancar el server, vía instrumentation.ts.
  if (isBuildPhase()) {
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
