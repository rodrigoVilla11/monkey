import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

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
      <body className="antialiased">{children}</body>
    </html>
  );
}
