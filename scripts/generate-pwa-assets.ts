/**
 * Genera los íconos y las pantallas de arranque de la PWA.
 *
 *   pnpm pwa:assets
 *
 * Todo sale del MISMO SVG del logo (`pwa-assets.config`), que es el que la app
 * también muestra en pantalla: cambiar el logo es reemplazar ese archivo y
 * volver a correr esto, no reexportar diez imágenes a mano.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";

import {
  APPLE_TOUCH_SIZES,
  BRAND,
  ICON_SIZES,
  LOGO_PUBLIC_PATH,
  SPLASH_SCREENS,
  TAGLINE,
  iconFileName,
} from "./pwa-assets.config";

const LOGO_FILE = join(
  process.cwd(),
  "public",
  ...LOGO_PUBLIC_PATH.split("/").filter(Boolean),
);
const ICONS_DIR = join(process.cwd(), "public", "icons");
const SPLASH_DIR = join(process.cwd(), "public", "splash");

/**
 * Ícono cuadrado: el SVG del logo rasterizado a `size` píxeles.
 *
 * Sin `rounded` va a sangre completa, que es lo que piden iOS (apple-touch) y
 * Android (maskable): los dos aplican su propia máscara, y dibujar nuestras
 * esquinas dejaría un borde visible dentro del recorte — en iOS, además,
 * negro, porque rellena la transparencia. No hace falta achicar nada para
 * maskable: el mono ya entra en la zona segura (el círculo central del 80%).
 *
 * `rounded` recorta las esquinas para donde nadie aplica máscara: el favicon,
 * los íconos `any` del manifest y la placa de las pantallas de arranque.
 */
const iconPng = async (size: number, rounded: boolean): Promise<Buffer> => {
  const icon = sharp(LOGO_FILE).resize(size, size);

  if (rounded) {
    const mask = `<svg xmlns="http://www.w3.org/2000/svg" width="${String(size)}" height="${String(size)}">
      <rect width="${String(size)}" height="${String(size)}" rx="${String(Math.round(size * 0.22))}" fill="#ffffff"/>
    </svg>`;
    icon.composite([{ input: Buffer.from(mask), blend: "dest-in" }]);
  }

  return icon.png({ compressionLevel: 9 }).toBuffer();
};

/**
 * Pantalla de arranque: fondo oscuro con el ícono centrado, tal como se ve
 * en el home del iPhone, y debajo el nombre con el eslogan.
 *
 * El texto se dibuja con la fuente sans del sistema donde corre el script
 * (los PNG van commiteados, así que manda la máquina que corre `pwa:assets`).
 * La K va en el azul brillante de la marca, igual que el wordmark en la app.
 */
const splashPng = async (width: number, height: number): Promise<Buffer> => {
  const box = Math.round(Math.min(width, height) * 0.26);
  const cx = Math.round(width / 2);
  const cy = Math.round(height / 2);
  const nameSize = Math.round(box * 0.2);
  const taglineSize = Math.round(box * 0.11);
  const nameY = cy + Math.round(box / 2) + Math.round(box * 0.3);
  const taglineY = nameY + Math.round(box * 0.16);
  const font = "Segoe UI, SF Pro Text, Helvetica Neue, Arial, sans-serif";

  const bg = `<svg xmlns="http://www.w3.org/2000/svg" width="${String(width)}" height="${String(height)}">
    <rect width="${String(width)}" height="${String(height)}" fill="${BRAND.background}"/>
    <text x="${String(cx)}" y="${String(nameY)}" text-anchor="middle" font-family="${font}"
          font-size="${String(nameSize)}" font-weight="600" fill="#ffffff">mon<tspan fill="#2691e2">K</tspan>ey</text>
    <text x="${String(cx)}" y="${String(taglineY)}" text-anchor="middle" font-family="${font}"
          font-size="${String(taglineSize)}" fill="#98a3ae">${TAGLINE}</text>
  </svg>`;

  return sharp(Buffer.from(bg))
    .composite([
      {
        input: await iconPng(box, true),
        left: cx - Math.round(box / 2),
        top: cy - Math.round(box / 2),
      },
    ])
    .png({ compressionLevel: 9 })
    .toBuffer();
};

const main = async (): Promise<void> => {
  await mkdir(ICONS_DIR, { recursive: true });
  await mkdir(SPLASH_DIR, { recursive: true });

  for (const { size, purpose } of ICON_SIZES) {
    const file = iconFileName(size, purpose);
    await writeFile(
      join(ICONS_DIR, file),
      await iconPng(size, purpose !== "maskable"),
    );
    console.log(`  icons/${file}`);
  }

  // apple-touch-icon: a sangre completa y opacos, iOS redondea por su cuenta.
  for (const size of APPLE_TOUCH_SIZES) {
    const file = `apple-touch-icon-${String(size)}.png`;
    await writeFile(join(ICONS_DIR, file), await iconPng(size, false));
    console.log(`  icons/${file}`);
  }

  // El default que busca iOS cuando no encuentra un `<link>` que le sirva.
  await writeFile(
    join(ICONS_DIR, "apple-touch-icon.png"),
    await iconPng(180, false),
  );
  console.log("  icons/apple-touch-icon.png");

  // Favicon clásico, para la pestaña del navegador de escritorio.
  await writeFile(join(ICONS_DIR, "favicon-32.png"), await iconPng(32, true));
  console.log("  icons/favicon-32.png");

  for (const spec of SPLASH_SCREENS) {
    const file = `${spec.name}.png`;
    await writeFile(
      join(SPLASH_DIR, file),
      await splashPng(spec.width, spec.height),
    );
    console.log(
      `  splash/${file}  ${String(spec.width)}×${String(spec.height)}  (${spec.devices})`,
    );
  }

  console.log(
    `\n✓ ${String(ICON_SIZES.length + APPLE_TOUCH_SIZES.length + 2)} íconos y ${String(SPLASH_SCREENS.length)} pantallas de arranque`,
  );
};

main().catch((error: unknown) => {
  console.error(
    "✖ No se pudieron generar los assets:",
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
