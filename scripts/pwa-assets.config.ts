/**
 * Definición de los assets de PWA.
 *
 * Está separada del generador para que el layout pueda importar la tabla de
 * splash screens y emitir los `<link>` sin duplicar medidas. Si las dos listas
 * se escribieran por separado, tarde o temprano dejarían de coincidir y algún
 * iPhone quedaría sin su pantalla de arranque sin que nadie se entere.
 */

export const BRAND = {
  background: "#09090b",
  foreground: "#fafafa",
  accent: "#f59e0b",
} as const;

/**
 * Pantallas de arranque de iOS.
 *
 * iOS no escala: si no hay una imagen con las medidas EXACTAS del dispositivo,
 * no muestra ninguna y el arranque queda en blanco. Por eso la tabla es larga
 * y explícita.
 *
 * `width`/`height` son píxeles físicos; `cssWidth`/`cssHeight`, puntos CSS.
 * El media query se arma con los puntos y el device-pixel-ratio.
 */
export interface SplashSpec {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly cssWidth: number;
  readonly cssHeight: number;
  readonly ratio: number;
  readonly devices: string;
}

export const SPLASH_SCREENS: readonly SplashSpec[] = [
  {
    name: "iphone-16-pro-max",
    width: 1320,
    height: 2868,
    cssWidth: 440,
    cssHeight: 956,
    ratio: 3,
    devices: "iPhone 16 Pro Max",
  },
  {
    name: "iphone-16-pro",
    width: 1206,
    height: 2622,
    cssWidth: 402,
    cssHeight: 874,
    ratio: 3,
    devices: "iPhone 16 Pro",
  },
  {
    name: "iphone-16-plus",
    width: 1290,
    height: 2796,
    cssWidth: 430,
    cssHeight: 932,
    ratio: 3,
    devices: "iPhone 16 Plus, 15 Pro Max, 15 Plus, 14 Pro Max",
  },
  {
    name: "iphone-16",
    width: 1179,
    height: 2556,
    cssWidth: 393,
    cssHeight: 852,
    ratio: 3,
    devices: "iPhone 16, 15 Pro, 15, 14 Pro",
  },
  {
    name: "iphone-14-plus",
    width: 1284,
    height: 2778,
    cssWidth: 428,
    cssHeight: 926,
    ratio: 3,
    devices: "iPhone 14 Plus, 13 Pro Max, 12 Pro Max",
  },
  {
    name: "iphone-14",
    width: 1170,
    height: 2532,
    cssWidth: 390,
    cssHeight: 844,
    ratio: 3,
    devices: "iPhone 14, 13, 13 Pro, 12, 12 Pro",
  },
  {
    name: "iphone-13-mini",
    width: 1125,
    height: 2436,
    cssWidth: 375,
    cssHeight: 812,
    ratio: 3,
    devices: "iPhone 13 mini, 12 mini, 11 Pro, XS, X",
  },
  {
    name: "iphone-11-pro-max",
    width: 1242,
    height: 2688,
    cssWidth: 414,
    cssHeight: 896,
    ratio: 3,
    devices: "iPhone 11 Pro Max, XS Max",
  },
  {
    name: "iphone-11",
    width: 828,
    height: 1792,
    cssWidth: 414,
    cssHeight: 896,
    ratio: 2,
    devices: "iPhone 11, XR",
  },
  {
    name: "iphone-se",
    width: 750,
    height: 1334,
    cssWidth: 375,
    cssHeight: 667,
    ratio: 2,
    devices: "iPhone SE (2ª y 3ª gen), 8, 7, 6s",
  },
];

/** Media query que iOS usa para elegir la imagen. */
export const splashMedia = (spec: SplashSpec): string =>
  `(device-width: ${String(spec.cssWidth)}px) and (device-height: ${String(spec.cssHeight)}px) ` +
  `and (-webkit-device-pixel-ratio: ${String(spec.ratio)}) and (orientation: portrait)`;

/** Íconos del manifest y apple-touch-icon. */
export const ICON_SIZES = [
  { size: 192, purpose: "any" },
  { size: 512, purpose: "any" },
  { size: 192, purpose: "maskable" },
  { size: 512, purpose: "maskable" },
] as const;

export const APPLE_TOUCH_SIZES = [120, 152, 167, 180] as const;

export const iconFileName = (size: number, purpose: string): string =>
  purpose === "maskable"
    ? `icon-maskable-${String(size)}.png`
    : `icon-${String(size)}.png`;
