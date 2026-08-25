/**
 * Se ejecuta una vez al arrancar el server de Next, antes de servir requests.
 *
 * Es el único lugar donde se valida el entorno (no en next.config.ts: ver el
 * comentario de ese archivo). Si la configuración está mal, el proceso muere
 * en vez de quedar a medio andar sirviendo tráfico.
 *
 * La lógica vive en `instrumentation.node.ts`: este archivo se compila también
 * para el runtime Edge, y el check de NEXT_RUNTIME hace que el bundler ni
 * siquiera incluya el módulo node-only en ese bundle.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { validateEnv } = await import("./instrumentation.node");
  await validateEnv();
}
