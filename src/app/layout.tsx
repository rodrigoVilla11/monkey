import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import { Toaster } from "@/components/ui/sonner";
import { Providers } from "@/lib/providers";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Monkey",
    template: "%s · Monkey",
  },
  description: "Finanzas personales y compartidas",
  applicationName: "Monkey",
  appleWebApp: {
    capable: true,
    title: "Monkey",
    statusBarStyle: "black-translucent",
  },
  formatDetection: {
    // Que iOS no convierta importes ni fechas en links de teléfono.
    telephone: false,
    date: false,
    address: false,
    email: false,
  },
  other: {
    /**
     * Next 16 emite el `mobile-web-app-capable` estándar, pero las versiones
     * de iOS anteriores a la 16.4 solo entienden el prefijado de Apple. Sin
     * este, la app se abre con la barra de Safari encima en esos dispositivos.
     * Se mandan los dos.
     */
    "apple-mobile-web-app-capable": "yes",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Necesario para que env(safe-area-inset-*) devuelva algo distinto de 0.
  viewportFit: "cover",
  // Sin `userScalable: false`: iOS lo ignora desde iOS 10 y rompe WCAG 1.4.4.
  // El zoom al enfocar inputs lo resuelve la regla de 16px en globals.css.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#09090b" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="es" suppressHydrationWarning>
      <body className="antialiased">
        <Providers>{children}</Providers>
        {/* Los toasts van arriba: abajo chocan con la bottom nav y el FAB. */}
        <Toaster position="top-center" richColors closeButton={false} />
      </body>
    </html>
  );
}
