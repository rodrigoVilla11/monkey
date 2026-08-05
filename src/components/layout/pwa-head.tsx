import {
  APPLE_TOUCH_SIZES,
  SPLASH_SCREENS,
  splashMedia,
} from "../../../scripts/pwa-assets.config";

/**
 * Etiquetas de PWA que la Metadata API de Next no cubre.
 *
 * Los `apple-touch-startup-image` se generan desde la MISMA tabla que usa el
 * script que crea los PNG. Escribir los 10 `<link>` a mano garantizaba que
 * tarde o temprano una medida dejara de coincidir con su archivo y ese iPhone
 * arrancara en blanco, sin ningún error visible que lo delate.
 *
 * iOS no escala estas imágenes: si no encuentra uno con las medidas exactas
 * del dispositivo, simplemente no muestra ninguno.
 */
export function PwaHead() {
  return (
    <>
      {APPLE_TOUCH_SIZES.map((size) => (
        <link
          key={size}
          rel="apple-touch-icon"
          sizes={`${String(size)}x${String(size)}`}
          href={`/icons/apple-touch-icon-${String(size)}.png`}
        />
      ))}
      <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
      <link
        rel="icon"
        type="image/png"
        sizes="32x32"
        href="/icons/favicon-32.png"
      />

      {SPLASH_SCREENS.map((spec) => (
        <link
          key={spec.name}
          rel="apple-touch-startup-image"
          href={`/splash/${spec.name}.png`}
          media={splashMedia(spec)}
        />
      ))}
    </>
  );
}
