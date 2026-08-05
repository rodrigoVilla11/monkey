"use client";

import { CloudOff, RotateCw } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Pantalla offline.
 *
 * Es la que sirve el Service Worker cuando falla una navegación sin conexión.
 * Tiene que ser una página normal de Next para que entre en la precarga con el
 * resto del app shell.
 *
 * A propósito no promete nada que no pueda cumplir: la Fase 1 no tiene cola de
 * escrituras offline, así que no dice "se guardará cuando vuelvas". Decir eso
 * y perder un gasto sería peor que no ofrecerlo.
 */
export default function OfflinePage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-8 pt-safe-top pb-safe-bottom text-center">
      <CloudOff className="size-14 text-muted-foreground" />

      <div>
        <h1 className="text-xl font-semibold">Sin conexión</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          No pudimos cargar esta pantalla. Los datos que ya habías abierto
          siguen disponibles.
        </p>
      </div>

      <Button
        className="min-h-touch w-full max-w-xs"
        onClick={() => {
          window.location.reload();
        }}
      >
        <RotateCw className="size-4" />
        Reintentar
      </Button>
    </main>
  );
}
