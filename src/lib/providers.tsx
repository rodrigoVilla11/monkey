"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import { ApiError, SESSION_EXPIRED_EVENT } from "./api-client";

/**
 * Proveedores globales del cliente.
 *
 * Un `QueryClient` por montaje del árbol (no un singleton de módulo): con un
 * singleton, en desarrollo el hot reload arrastra caché entre recargas y
 * aparecen datos de una sesión anterior.
 */
const createQueryClient = (): QueryClient =>
  new QueryClient({
    defaultOptions: {
      queries: {
        /**
         * 30 s de frescura. En una app de finanzas los datos cambian poco
         * entre pantallas, y esto evita refetchear el dashboard cada vez que
         * se navega al listado y se vuelve.
         */
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        /**
         * En un PWA de iOS, volver de segundo plano dispara un focus. Sin
         * esto la pantalla queda con datos viejos después de días cerrada.
         */
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
        retry: (failureCount, error) => {
          // 4xx no se reintenta: un 403 o un 404 no mejoran insistiendo.
          if (error instanceof ApiError && error.status < 500) return false;
          return failureCount < 2;
        },
      },
      mutations: {
        // Las mutaciones no se reintentan solas: un doble POST duplicaría un
        // movimiento.
        retry: false,
      },
    },
  });

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(createQueryClient);
  const router = useRouter();

  /**
   * Sesión perdida de verdad (el refresh también falló). Se limpia la caché
   * ANTES de redirigir: si no, quien entre después con otra cuenta vería por
   * un instante los datos del anterior.
   */
  useEffect(() => {
    const onExpired = (): void => {
      queryClient.clear();
      router.replace("/login");
    };

    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => {
      window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
    };
  }, [queryClient, router]);

  return (
    <ThemeProvider
      attribute="class"
      // Oscuro por defecto, pero respetando prefers-color-scheme cuando el
      // sistema tiene una preferencia declarada.
      defaultTheme="dark"
      enableSystem
      disableTransitionOnChange
    >
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </ThemeProvider>
  );
}
