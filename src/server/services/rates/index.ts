import { systemClient } from "@/server/db/system";
import { fromCalendarDate, todayIn, type CalendarDate } from "@/shared/dates";

/**
 * Cotizaciones entre monedas.
 *
 * Detrás de una interfaz a propósito: hoy solo hay carga manual, pero un
 * proveedor automático (BCE, BCRA, lo que sea) entra acá sin tocar los
 * services que la consumen.
 *
 * Con ARS de por medio, "qué cotización" (oficial, MEP, blue) es una decisión
 * de producto, no técnica, y por eso la Fase 1 no la toma: se guarda lo que se
 * cargue a mano.
 *
 * `ExchangeRate` es la ÚNICA tabla del dominio sin `spaceId`: las cotizaciones
 * no pertenecen a nadie. Está en el allowlist de la extensión de scope.
 */

export interface RateLookup {
  readonly rate: string;
  readonly date: CalendarDate;
  readonly source: string;
}

export interface ExchangeRateProvider {
  /**
   * Cotización de `base` a `quote` vigente en `onDate` o antes.
   * `null` si no hay ninguna cargada: quien llama decide si eso es un error.
   */
  find(
    base: string,
    quote: string,
    onDate: CalendarDate,
  ): Promise<RateLookup | null>;
}

/**
 * Busca la última cotización cargada con fecha menor o igual a la pedida.
 *
 * "Menor o igual" y no "exacta" porque los fines de semana y feriados no
 * tienen cotización: se usa la del último día hábil, que es lo que hace
 * cualquier contabilidad.
 */
class ManualRateProvider implements ExchangeRateProvider {
  public async find(
    base: string,
    quote: string,
    onDate: CalendarDate,
  ): Promise<RateLookup | null> {
    if (base === quote) {
      return { rate: "1", date: onDate, source: "identity" };
    }

    const db = systemClient();
    const target = fromCalendarDate(onDate);

    const direct = await db.exchangeRate.findFirst({
      where: {
        baseCurrency: base,
        quoteCurrency: quote,
        date: { lte: target },
      },
      orderBy: { date: "desc" },
      select: { rate: true, date: true, source: true },
    });

    if (direct !== null) {
      return {
        rate: direct.rate.toString(),
        date: toCalendar(direct.date),
        source: direct.source,
      };
    }

    /**
     * Si no está el par directo, se prueba el inverso y se invierte.
     * Guardar EUR→ARS y ARS→EUR por separado obligaría a mantener los dos
     * sincronizados y a que no se contradigan.
     */
    const inverse = await db.exchangeRate.findFirst({
      where: {
        baseCurrency: quote,
        quoteCurrency: base,
        date: { lte: target },
      },
      orderBy: { date: "desc" },
      select: { rate: true, date: true, source: true },
    });

    if (inverse === null) return null;

    return {
      rate: invert(inverse.rate.toString()),
      date: toCalendar(inverse.date),
      source: `${inverse.source}:inverso`,
    };
  }
}

const toCalendar = (date: Date): CalendarDate => todayIn("UTC", date);

/**
 * 1 / rate con 12 decimales, sin pasar por `number`.
 *
 * Se hace con enteros para no perder precisión: invertir 1234.5678 en punto
 * flotante y volver a multiplicar no devuelve el importe original.
 */
const invert = (rate: string): string => {
  const [whole = "0", fraction = ""] = rate.split(".");
  const scale = BigInt(fraction.length);
  const numerator = BigInt(`${whole}${fraction}`);
  if (numerator === 0n) return "0";

  const PRECISION = 12n;
  // (10^scale / numerator) con 12 decimales de precisión.
  const scaled = 10n ** (scale + PRECISION) / numerator;
  const text = scaled.toString().padStart(Number(PRECISION) + 1, "0");
  const cut = text.length - Number(PRECISION);

  return (
    `${text.slice(0, cut)}.${text.slice(cut)}`.replace(/\.?0+$/, "") || "0"
  );
};

let instance: ExchangeRateProvider | undefined;

export const getRateProvider = (): ExchangeRateProvider => {
  instance ??= new ManualRateProvider();
  return instance;
};

/** Solo para tests: permite inyectar un proveedor de mentira. */
export const setRateProvider = (provider: ExchangeRateProvider): void => {
  instance = provider;
};
