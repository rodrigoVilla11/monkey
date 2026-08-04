/**
 * Se ejecuta una vez al arrancar el server de Next, antes de servir requests.
 * Si el entorno está mal configurado, el proceso muere acá y no medio andando.
 */
export function register(): void {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // Import dinámico: `env.ts` no puede evaluarse en el runtime Edge.
  void import("./env");
}
