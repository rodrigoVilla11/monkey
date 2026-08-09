"use client";

import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";

import { BottomNav } from "@/components/layout/bottom-nav";
import { SpaceSwitcher } from "@/components/layout/space-switcher";
import { Skeleton } from "@/components/ui/skeleton";
import { useActiveSpace, useSession } from "@/lib/hooks/use-session";

/**
 * Shell de la app.
 *
 * Estructura pensada para iOS:
 *  · header fijo arriba con `pt-safe-top`
 *  · UN solo contenedor con scroll (`app-scroll`), que aísla el bounce
 *  · bottom nav fija abajo con `pb-safe-bottom`
 *
 * El padding inferior del contenido deja lugar a la barra: sin eso, el último
 * movimiento de la lista queda tapado.
 *
 * `h-dvh` y no `min-h-dvh`: con un alto mínimo el shell crece con el
 * contenido, `main` mide lo que mide la lista entera y entonces no tiene nada
 * que scrollear. Ahí `overscroll-behavior: contain` —que está para que el
 * bounce no se propague— se convierte en la trampa: `main` se come la rueda y
 * el dedo, no los deja llegar al documento, y la app queda clavada. El alto
 * tiene que ser definido para que el scroll viva adentro de `main`.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  const session = useSession();
  const { space, spaces, isLoading } = useActiveSpace();
  const router = useRouter();

  // Sin sesión → login. Con sesión sin verificar → pantalla de verificación.
  useEffect(() => {
    if (session.isError) router.replace("/login");
    else if (session.data?.emailVerified === false)
      router.replace("/verify-email");
  }, [session.isError, session.data?.emailVerified, router]);

  if (isLoading || session.data === undefined) {
    return <AppSkeleton />;
  }

  return (
    <div className="flex h-dvh flex-col">
      <header className="fixed inset-x-0 top-0 z-40 border-b bg-background/85 pt-safe-top backdrop-blur-lg">
        <div className="mx-auto flex h-[var(--spacing-header)] max-w-lg items-center px-4">
          {space !== undefined && spaces !== undefined && (
            <SpaceSwitcher space={space} spaces={spaces} />
          )}
        </div>
      </header>

      <main
        className="app-scroll mx-auto w-full max-w-lg flex-1 px-4"
        style={{
          paddingTop: "calc(var(--spacing-header) + var(--spacing-safe-top))",
          paddingBottom:
            "calc(var(--spacing-bottom-nav) + var(--spacing-safe-bottom) + 1.5rem)",
        }}
      >
        {children}
      </main>

      <BottomNav />
    </div>
  );
}

function AppSkeleton() {
  return (
    <div className="mx-auto max-w-lg space-y-4 p-4 pt-20">
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-28 w-full rounded-xl" />
      <Skeleton className="h-20 w-full rounded-xl" />
      <Skeleton className="h-20 w-full rounded-xl" />
    </div>
  );
}
