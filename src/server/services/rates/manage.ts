import { errors } from "@/server/api/errors";
import type { ScopedDb } from "@/server/db/scoped";
import type { TransactionClient } from "@/server/services/audit/log";
import type {
  CreateRateRequest,
  ExchangeRateDTO,
  MissingRateDTO,
  RateFilters,
  RatesResponse,
} from "@/shared/contracts/rates";
import { fromCalendarDate, toCalendarDate, todayIn } from "@/shared/dates";

import { getRateProvider } from "./index";

/**
 * Alta y listado de cotizaciones.
 *
 * El proveedor (`./index.ts`) solo LEE. Esto es lo que faltaba para que la
 * multi-moneda funcione de verdad: sin una forma de cargar cotizaciones, una
 * cuenta en dólares dentro de un Space en euros dice "falta la cotización" para
 * siempre y no hay nada que se pueda hacer al respecto desde la app.
 *
 * Se escribe con el cliente scopeado igual que todo lo demás: `ExchangeRate`
 * está en el allowlist de la extensión, así que pasa sin filtro de Space —que
 * es justo lo que se quiere, porque las cotizaciones son globales.
 */

const toDTO = (row: {
  id: string;
  baseCurrency: string;
  quoteCurrency: string;
  rate: { toString(): string };
  date: Date;
  source: string;
  createdAt: Date;
}): ExchangeRateDTO => ({
  id: row.id,
  baseCurrency: row.baseCurrency,
  quoteCurrency: row.quoteCurrency,
  rate: row.rate.toString(),
  date: toCalendarDate(row.date),
  source: row.source,
  createdAt: row.createdAt.toISOString(),
});

const SELECT = {
  id: true,
  baseCurrency: true,
  quoteCurrency: true,
  rate: true,
  date: true,
  source: true,
  createdAt: true,
} as const;

export const listRates = async (
  db: ScopedDb,
  space: { readonly primaryCurrency: string; readonly timezone: string },
  filters: RateFilters,
): Promise<RatesResponse> => {
  const rows = await db.exchangeRate.findMany({
    where: {
      ...(filters.baseCurrency !== undefined
        ? { baseCurrency: filters.baseCurrency }
        : {}),
      ...(filters.quoteCurrency !== undefined
        ? { quoteCurrency: filters.quoteCurrency }
        : {}),
    },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    take: 100,
    select: SELECT,
  });

  return {
    rates: rows.map(toDTO),
    missing: await missingRates(db, space),
  };
};

/**
 * Qué cotizaciones le faltan a ESTE Space para que sus números cuadren.
 *
 * Sale de mirar las monedas que el Space usa de verdad —sus cuentas— y
 * preguntarle al proveedor si sabe convertirlas. Sin esto, la pantalla de
 * cotizaciones sería un formulario a ciegas: nadie sabe de memoria qué pares
 * necesita la app.
 */
const missingRates = async (
  db: ScopedDb,
  space: { readonly primaryCurrency: string; readonly timezone: string },
): Promise<MissingRateDTO[]> => {
  const accounts = await db.account.findMany({
    where: { isArchived: false },
    select: { currency: true, name: true },
  });

  const today = todayIn(space.timezone);
  const provider = getRateProvider();
  const seen = new Set<string>();
  const missing: MissingRateDTO[] = [];

  for (const account of accounts) {
    if (account.currency === space.primaryCurrency) continue;
    if (seen.has(account.currency)) continue;
    seen.add(account.currency);

    const found = await provider.find(
      account.currency,
      space.primaryCurrency,
      today,
    );
    if (found !== null) continue;

    missing.push({
      baseCurrency: account.currency,
      quoteCurrency: space.primaryCurrency,
      reason: `Cuenta "${account.name}"`,
    });
  }

  return missing;
};

export const createRate = async (
  tx: TransactionClient,
  timezone: string,
  input: CreateRateRequest,
): Promise<ExchangeRateDTO> => {
  const date = input.date ?? todayIn(timezone);

  /**
   * Una cotización del mismo par, día y fuente se REEMPLAZA en vez de fallar.
   * Corregir un número mal tecleado es el caso normal; obligar a borrar y
   * volver a crear no aporta nada. El unique de la base es
   * (base, quote, date, source), así que el upsert calza exacto.
   */
  const row = await tx.exchangeRate.upsert({
    where: {
      baseCurrency_quoteCurrency_date_source: {
        baseCurrency: input.baseCurrency,
        quoteCurrency: input.quoteCurrency,
        date: fromCalendarDate(date),
        source: "manual",
      },
    },
    create: {
      baseCurrency: input.baseCurrency,
      quoteCurrency: input.quoteCurrency,
      rate: input.rate,
      date: fromCalendarDate(date),
      source: "manual",
    },
    update: { rate: input.rate },
    select: SELECT,
  });

  return toDTO(row);
};

export const deleteRate = async (
  db: ScopedDb,
  tx: TransactionClient,
  id: string,
): Promise<void> => {
  const existing = await db.exchangeRate.findFirst({
    where: { id },
    select: { id: true },
  });
  if (existing === null) throw errors.notFound("No se encontró la cotización");

  await tx.exchangeRate.delete({ where: { id } });
};
