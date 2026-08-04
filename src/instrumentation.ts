/**
 * Se ejecuta una vez al arrancar el server de Next, antes de servir requests.
 *
 * Es el único lugar donde se valida el entorno (no en next.config.ts: ver el
 * comentario de ese archivo). Si la configuración está mal, el proceso muere
 * acá en vez de quedar a medio andar sirviendo tráfico.
 *
 * El `process.exit(1)` es deliberado: sin él, el rechazo del import queda como
 * unhandled rejection, Next lo loguea y el contenedor sigue arriba y
 * respondiendo — que es justo lo que esta validación tiene que evitar.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  try {
    await import("./env");
  } catch {
    // env.ts ya imprimió qué variable está mal y por qué.
    process.exit(1);
  }
}
