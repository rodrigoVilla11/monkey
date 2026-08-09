import type { ReactNode } from "react";

import { BrandLockup } from "@/components/brand/logo";

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
        {/* h1 y no un div suelto: en estas pantallas la marca ES el título. */}
        <h1 className="mb-8">
          <BrandLockup />
        </h1>
        {children}
      </div>
    </div>
  );
}
