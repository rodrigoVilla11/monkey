import type { ReactNode } from "react";

/**
 * Shell de las pantallas sin sesión.
 *
 * Sin bottom nav ni selector de Space: acá todavía no hay ninguno de los dos.
 * Centrado vertical con `min-h-dvh` (no `100vh`), que en Safari no salta
 * cuando aparece o desaparece la barra de direcciones.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col justify-center px-6 py-10 pt-safe-top pb-safe-bottom">
      <div className="mx-auto w-full max-w-sm">
        <div className="mb-8 text-center">
          <span className="text-5xl" aria-hidden>
            🐒
          </span>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">Monkey</h1>
        </div>
        {children}
      </div>
    </div>
  );
}
