import type { ScopedDb } from "@/server/db/scoped";

/**
 * Suma de importes en la moneda primaria del Space.
 *
 * ── El problema que resuelve ──────────────────────────────────────────────
 * `Transaction.amountPrimaryMinor` SOLO está poblado cuando la moneda del
 * movimiento difiere de la primaria. Eso hace que agregar las dos columnas por
 * separado sea una trampa:
 *
 *   · `SUM(amountMinor)`        cubre TODAS las filas, en monedas mezcladas
 *   · `SUM(amountPrimaryMinor)` cubre solo las convertidas
 *
 * Quedarse con una u otra según cuál dé mayor que cero descarta en silencio
 * los movimientos que ya estaban en la moneda primaria en cuanto aparece uno
 * en otra moneda. En SQL sería `SUM(COALESCE(primary, own))`, pero el `groupBy`
 * de Prisma no admite expresiones.
 *
 * La solución es partir la consulta en dos —las que tienen conversión y las
 * que no— y sumar los resultados. Cuesta una consulta extra y es correcta.
 *
 * Está en un solo lugar a propósito: la misma regla la necesitan el dashboard,
 * los presupuestos y los reportes, y tenerla duplicada fue justamente lo que
 * hizo que el bug existiera en dos sitios a la vez.
 */

export interface PrimaryTotal {
  readonly totalMinor: bigint;
  readonly count: number;
}

type Where = Record<string, unknown>;

export const sumInPrimary = async (
  db: ScopedDb,
  where: Where,
): Promise<PrimaryTotal> => {
  const [own, converted] = await Promise.all([
    db.transaction.aggregate({
      where: { ...where, amountPrimaryMinor: null },
      _sum: { amountMinor: true },
      _count: { _all: true },
    }),
    db.transaction.aggregate({
      where: { ...where, amountPrimaryMinor: { not: null } },
      _sum: { amountPrimaryMinor: true },
      _count: { _all: true },
    }),
  ]);

  return {
    totalMinor:
      (own._sum.amountMinor ?? 0n) + (converted._sum.amountPrimaryMinor ?? 0n),
    count: own._count._all + converted._count._all,
  };
};

/**
 * Igual, pero agrupando. `by` acepta uno o varios campos; la clave del Map es
 * el JSON de los valores de agrupación, para soportar claves compuestas.
 */
export interface GroupedTotal<T> extends PrimaryTotal {
  readonly key: T;
}

export const groupSumInPrimary = async <K extends string>(
  db: ScopedDb,
  by: readonly K[],
  where: Where,
): Promise<GroupedTotal<Record<K, string | null>>[]> => {
  const [own, converted] = await Promise.all([
    db.transaction.groupBy({
      // El tipado genérico de groupBy no acepta un array de claves variable;
      // el resultado se estrecha abajo.
      by: by as unknown as never,
      where: { ...where, amountPrimaryMinor: null },
      _sum: { amountMinor: true },
      _count: { _all: true },
    }),
    db.transaction.groupBy({
      by: by as unknown as never,
      where: { ...where, amountPrimaryMinor: { not: null } },
      _sum: { amountPrimaryMinor: true },
      _count: { _all: true },
    }),
  ]);

  interface RawGroup {
    _sum: { amountMinor?: bigint | null; amountPrimaryMinor?: bigint | null };
    _count: { _all: number };
    [field: string]: unknown;
  }

  const merged = new Map<string, GroupedTotal<Record<K, string | null>>>();

  const accumulate = (rows: unknown, useConverted: boolean): void => {
    for (const row of rows as RawGroup[]) {
      const key = {} as Record<K, string | null>;
      for (const field of by) {
        const value = row[field];
        key[field] =
          value === null || value === undefined ? null : String(value);
      }

      const id = JSON.stringify(by.map((field) => key[field]));
      const amount = useConverted
        ? (row._sum.amountPrimaryMinor ?? 0n)
        : (row._sum.amountMinor ?? 0n);

      const existing = merged.get(id);
      merged.set(id, {
        key,
        totalMinor: (existing?.totalMinor ?? 0n) + amount,
        count: (existing?.count ?? 0) + row._count._all,
      });
    }
  };

  accumulate(own, false);
  accumulate(converted, true);

  return [...merged.values()];
};
