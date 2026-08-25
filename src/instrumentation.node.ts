/**
 * Parte node-only del arranque. Vive en un archivo aparte porque
 * `instrumentation.ts` se compila TAMBIÉN para el runtime Edge, donde
 * `process.exit` no existe y Turbopack lo marca en cada build. Con el import
 * dinámico detrás del check de NEXT_RUNTIME, este archivo queda fuera del
 * bundle de Edge y el warning desaparece.
 */
export async function validateEnv(): Promise<void> {
  try {
    await import("./env");
  } catch {
    // env.ts ya imprimió qué variable está mal y por qué. El exit es
    // deliberado: sin él, el rechazo queda como unhandled rejection y el
    // contenedor sigue arriba sirviendo tráfico mal configurado.
    process.exit(1);
  }
}
