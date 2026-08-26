import type { MetadataRoute } from "next";

/**
 * Manifest de la PWA, como metadata route de Next.
 *
 * Se genera desde TypeScript y no como JSON estático para que los tipos
 * avisen si falta algo obligatorio, y para poder derivar valores de las
 * mismas constantes que usan los assets.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "monKey · Finanzas",
    short_name: "monKey",
    description: "Finanzas personales y compartidas",
    id: "/",
    start_url: "/",
    scope: "/",
    /** Sin barra de navegador: es lo que la hace sentir una app. */
    display: "standalone",
    orientation: "portrait",
    background_color: "#0d1117",
    theme_color: "#0d1117",
    lang: "es",
    dir: "ltr",
    categories: ["finance", "productivity"],
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      /**
       * Los maskable van aparte y NO se combinan con "any" en el mismo
       * `purpose`: Android recorta hasta un 20% por lado, y una imagen
       * declarada para las dos cosas termina o con márgenes enormes en el
       * navegador o con el logo mutilado en el launcher.
       */
      {
        src: "/icons/icon-maskable-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    shortcuts: [
      {
        name: "Cargar un gasto",
        short_name: "Nuevo gasto",
        url: "/transactions/new",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }],
      },
    ],
  };
}
