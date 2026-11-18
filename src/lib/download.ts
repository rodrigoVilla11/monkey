/**
 * Entrega un archivo al navegador para que lo guarde.
 *
 * Un enlace temporal con `download` es la única forma de que el navegador
 * respete el nombre que propuso el servidor. La URL del objeto se libera
 * después de un momento y no de inmediato: en iOS, revocarla en el mismo tick
 * cancela la descarga que acaba de empezar.
 */
export const saveBlob = (blob: Blob, filename: string): void => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 10_000);
};
