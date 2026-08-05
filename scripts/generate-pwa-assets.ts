/**
 * Genera los íconos y las pantallas de arranque de la PWA.
 *
 *   pnpm pwa:assets
 *
 * Se dibuja todo desde SVG con `sharp` en vez de guardar PNG en el repo:
 * cambiar el color de marca es editar una constante y volver a correr esto,
 * no reexportar diez archivos a mano.
 *
 * El logo es geometría pura, sin tipografías ni emoji: un emoji renderizado
 * depende de qué fuente tenga instalada la máquina que corre el script, y el
 * mismo comando daría resultados distintos en macOS, Linux y Windows.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";

import {
  APPLE_TOUCH_SIZES,
  BRAND,
  ICON_SIZES,
  SPLASH_SCREENS,
  iconFileName,
} from "./pwa-assets.config";

const ICONS_DIR = join(process.cwd(), "public", "icons");
const SPLASH_DIR = join(process.cwd(), "public", "splash");

/**
 * Carita de mono, en un viewBox de 100×100.
 *
 * `scale` encoge el dibujo hacia el centro. Se usa para los íconos maskable:
 * Android recorta hasta un 20% por cada lado, así que todo lo que importa
 * tiene que caber en el 60% central o se come las orejas — literalmente.
 */
const monkeyMark = (scale: number): string => {
  const offset = (100 - 100 * scale) / 2;

  return `
    <g transform="translate(${String(offset)} ${String(offset)}) scale(${String(scale)})">
      <circle cx="22" cy="34" r="15" fill="${BRAND.accent}"/>
      <circle cx="78" cy="34" r="15" fill="${BRAND.accent}"/>
      <circle cx="22" cy="34" r="7"  fill="${BRAND.background}" opacity="0.35"/>
      <circle cx="78" cy="34" r="7"  fill="${BRAND.background}" opacity="0.35"/>
      <ellipse cx="50" cy="48" rx="30" ry="31" fill="${BRAND.accent}"/>
      <ellipse cx="50" cy="60" rx="21" ry="18" fill="${BRAND.foreground}" opacity="0.92"/>
      <circle cx="39" cy="44" r="4.5" fill="${BRAND.background}"/>
      <circle cx="61" cy="44" r="4.5" fill="${BRAND.background}"/>
      <ellipse cx="44" cy="57" rx="2.6" ry="2" fill="${BRAND.background}" opacity="0.65"/>
      <ellipse cx="56" cy="57" rx="2.6" ry="2" fill="${BRAND.background}" opacity="0.65"/>
      <path d="M40 66 Q50 73 60 66" stroke="${BRAND.background}" stroke-width="3"
            stroke-linecap="round" fill="none" opacity="0.65"/>
    </g>`;
};

/**
 * Ícono cuadrado.
 *
 * `maskable` va a sangre completa (sin esquinas redondeadas) porque el sistema
 * operativo aplica su propia máscara: dibujar las nuestras dejaría un borde
 * visible dentro del recorte de Android.
 */
const iconSvg = (size: number, maskable: boolean): string => {
  const radius = maskable ? 0 : size * 0.22;
  const scale = maskable ? 0.6 : 0.82;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${String(size)}" height="${String(size)}" viewBox="0 0 100 100">
    <rect width="100" height="100" rx="${String((radius / size) * 100)}" fill="${BRAND.background}"/>
    ${monkeyMark(scale)}
  </svg>`;
};

/** Pantalla de arranque: fondo liso con el logo centrado. */
const splashSvg = (width: number, height: number): string => {
  const logo = Math.round(Math.min(width, height) * 0.28);
  const x = Math.round((width - logo) / 2);
  const y = Math.round((height - logo) / 2);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${String(width)}" height="${String(height)}">
    <rect width="${String(width)}" height="${String(height)}" fill="${BRAND.background}"/>
    <svg x="${String(x)}" y="${String(y)}" width="${String(logo)}" height="${String(logo)}" viewBox="0 0 100 100">
      ${monkeyMark(0.9)}
    </svg>
  </svg>`;
};

const render = async (svg: string, target: string): Promise<void> => {
  const png = await sharp(Buffer.from(svg))
    .png({ compressionLevel: 9 })
    .toBuffer();
  await writeFile(target, png);
};

const main = async (): Promise<void> => {
  await mkdir(ICONS_DIR, { recursive: true });
  await mkdir(SPLASH_DIR, { recursive: true });

  for (const { size, purpose } of ICON_SIZES) {
    const file = iconFileName(size, purpose);
    await render(iconSvg(size, purpose === "maskable"), join(ICONS_DIR, file));
    console.log(`  icons/${file}`);
  }

  // apple-touch-icon: iOS no aplica máscara ni redondea por su cuenta en
  // versiones viejas, así que van con las esquinas ya dibujadas.
  for (const size of APPLE_TOUCH_SIZES) {
    const file = `apple-touch-icon-${String(size)}.png`;
    await render(iconSvg(size, false), join(ICONS_DIR, file));
    console.log(`  icons/${file}`);
  }

  // El default que busca iOS cuando no encuentra un `<link>` que le sirva.
  await render(iconSvg(180, false), join(ICONS_DIR, "apple-touch-icon.png"));
  console.log("  icons/apple-touch-icon.png");

  // Favicon clásico, para la pestaña del navegador de escritorio.
  await render(iconSvg(32, false), join(ICONS_DIR, "favicon-32.png"));
  console.log("  icons/favicon-32.png");

  for (const spec of SPLASH_SCREENS) {
    const file = `${spec.name}.png`;
    await render(splashSvg(spec.width, spec.height), join(SPLASH_DIR, file));
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
