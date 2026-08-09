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
  /** Sombra del acento: orejas por dentro. Da profundidad sin degradés. */
  accentDeep: "#b45309",
  /** Hocico. Crudo y no blanco puro: sobre negro, el blanco vibra. */
  muzzle: "#fdf6ec",
} as const;

/**
 * La marca: carita de mono con un ojo de cerradura por nariz.
 *
 * El nombre es **monKey**, y la cerradura es lo que lo cuenta sin escribirlo.
 * Vive acá y no en el generador porque la app también la dibuja (pantallas de
 * login, encabezados): si hubiera dos copias del path, el ícono instalado y el
 * de adentro de la app se irían separando con cada retoque.
 *
 * Todo en un viewBox de 100×100, con geometría pura: sin tipografías ni emoji,
 * que dependen de qué fuentes tenga la máquina que corre el script y harían que
 * el mismo comando diera resultados distintos en macOS, Linux y Windows.
 *
 * `scale` encoge el dibujo hacia el centro. Se usa para los íconos maskable:
 * Android recorta hasta un 20% por cada lado, así que todo lo que importa tiene
 * que caber en el 60% central o se come las orejas — literalmente.
 *
 * `compact` es la versión para tamaños chicos (favicon de 32px, la marca en un
 * encabezado). Abajo de ~48px la sonrisa y los brillos de los ojos dejan de
 * leerse como rasgos y se empastan en manchas grises: mejor no dibujarlos y
 * dejar que respiren los rasgos que sí sobreviven.
 */
export const monkeyMark = ({
  scale = 1,
  compact = false,
}: { scale?: number; compact?: boolean } = {}): string => {
  const offset = (100 - 100 * scale) / 2;
  const n = (value: number): string => String(value);

  const detail = compact
    ? ""
    : `
      <circle cx="40.3" cy="40.2" r="1.7" fill="${BRAND.muzzle}" opacity="0.92"/>
      <circle cx="63.3" cy="40.2" r="1.7" fill="${BRAND.muzzle}" opacity="0.92"/>
      <path d="M42.5 69.2 Q50 74.2 57.5 69.2" stroke="${BRAND.background}"
            stroke-width="2.6" stroke-linecap="round" fill="none" opacity="0.7"/>`;

  // La cerradura crece un poco en compacto: es el rasgo que tiene que
  // sobrevivir a 32px, y sin la sonrisa abajo tiene lugar de sobra.
  const keyhole = compact
    ? `<circle cx="50" cy="56" r="4.4" fill="${BRAND.background}"/>
       <path d="M47.2 58.8 L45 67.5 L55 67.5 L52.8 58.8 Z" fill="${BRAND.background}"/>`
    : `<circle cx="50" cy="55.5" r="3.8" fill="${BRAND.background}"/>
       <path d="M47.7 57.9 L46.2 64.4 L53.8 64.4 L52.3 57.9 Z" fill="${BRAND.background}"/>`;

  const eyeRadius = compact ? 5.4 : 5;

  return `
    <g transform="translate(${n(offset)} ${n(offset)}) scale(${n(scale)})">
      <circle cx="19" cy="36" r="15" fill="${BRAND.accent}"/>
      <circle cx="81" cy="36" r="15" fill="${BRAND.accent}"/>
      <circle cx="19.5" cy="36.5" r="7.4" fill="${BRAND.accentDeep}"/>
      <circle cx="80.5" cy="36.5" r="7.4" fill="${BRAND.accentDeep}"/>
      <ellipse cx="50" cy="50" rx="31" ry="30" fill="${BRAND.accent}"/>
      <ellipse cx="50" cy="62" rx="21.5" ry="15" fill="${BRAND.muzzle}"/>
      <circle cx="38.5" cy="42" r="${n(eyeRadius)}" fill="${BRAND.background}"/>
      <circle cx="61.5" cy="42" r="${n(eyeRadius)}" fill="${BRAND.background}"/>
      ${detail}
      ${keyhole}
    </g>`;
};

/** Abajo de este ancho en píxeles se dibuja la versión `compact`. */
export const COMPACT_BELOW = 48;

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
