import { Prisma } from "@/generated/prisma/client";
import { prisma } from "../client";

/**
 * SQL crudo para los reportes.
 *
 * Este es el ÚNICO directorio autorizado a usar `$queryRaw` — hay un test de
 * arquitectura que lo verifica. La regla que lo acompaña: **toda función recibe
 * `spaceId` como primer parámetro y lo filtra**, porque acá no llega la
 * extensión de scope.
 *
 * Se baja a SQL por una razón concreta: agrupar por mes necesita
 * `date_trunc`, y el `groupBy` de Prisma solo admite columnas, no expresiones.
 * La alternativa era una consulta por mes —doce viajes a la base para pintar
 * un gráfico— sobre una pantalla que se abre en un teléfono.
 *
 * `COALESCE(amountPrimaryMinor, amountMinor)` es la versión SQL de lo que hace
 * `sumInPrimary`: el campo convertido solo existe cuando la moneda difiere de
 * la primaria del Space.
 *
 * Todo va con `Prisma.sql` y parámetros: nunca interpolación de strings.
 */

export interface MonthlyRow {
  readonly month: string;
  readonly incomeMinor: bigint;
  readonly expenseMinor: bigint;
  readonly transactionCount: number;
}

/**
 * Serie mensual de ingresos y egresos.
 *
 * Las TRANSFERENCIAS quedan fuera: mover plata entre cuentas propias no es ni
 * ingreso ni gasto, y contarlas infla las dos columnas.
 *
 * Los meses sin movimientos NO aparecen: los rellena el service, que es donde
 * se sabe qué rango se pidió. Un `generate_series` acá ataría el SQL al
 * calendario del reporte.
 */
export const monthlyTotals = async (
  spaceId: string,
  from: Date,
  to: Date,
): Promise<MonthlyRow[]> => {
  const rows = await prisma.$queryRaw<
    {
      month: string;
      income: bigint | null;
      expense: bigint | null;
      count: bigint;
    }[]
  >(Prisma.sql`
    SELECT
      to_char(date_trunc('month', "date"), 'YYYY-MM') AS month,
      -- El cast a bigint es obligatorio: SUM() sobre bigint devuelve NUMERIC
      -- en Postgres, y Prisma lo mapea a Decimal, no a un bigint de JS. Sin
      -- esto revienta con "Cannot mix BigInt and other types" al operar.
      -- Los paréntesis también: el cast tiene que aplicarse al agregado
      -- completo, no al FILTER.
      (SUM(COALESCE("amountPrimaryMinor", "amountMinor"))
        FILTER (WHERE "type" = 'INCOME'))::bigint  AS income,
      (SUM(COALESCE("amountPrimaryMinor", "amountMinor"))
        FILTER (WHERE "type" = 'EXPENSE'))::bigint AS expense,
      COUNT(*) AS count
    FROM "Transaction"
    WHERE "spaceId" = ${spaceId}
      AND "deletedAt" IS NULL
      AND "type" IN ('INCOME', 'EXPENSE')
      AND "date" >= ${from}
      AND "date" <= ${to}
    GROUP BY 1
    ORDER BY 1
  `);

  return rows.map((row) => ({
    month: row.month,
    incomeMinor: row.income ?? 0n,
    expenseMinor: row.expense ?? 0n,
    transactionCount: Number(row.count),
  }));
};

export interface CategoryRow {
  readonly categoryId: string | null;
  readonly name: string;
  readonly color: string | null;
  readonly icon: string | null;
  readonly parentId: string | null;
  readonly totalMinor: bigint;
  readonly transactionCount: number;
}

/**
 * Desglose por categoría de un rango.
 *
 * Devuelve las categorías tal como están asignadas —hijas incluidas como
 * entradas propias— con su `parentId`, para que el service pueda agrupar por
 * padre o mostrar el detalle sin volver a consultar.
 */
export const categoryTotals = async (
  spaceId: string,
  from: Date,
  to: Date,
  kind: "INCOME" | "EXPENSE",
): Promise<CategoryRow[]> => {
  const rows = await prisma.$queryRaw<
    {
      categoryId: string | null;
      name: string | null;
      color: string | null;
      icon: string | null;
      parentId: string | null;
      total: bigint | null;
      count: bigint;
    }[]
  >(Prisma.sql`
    SELECT
      t."categoryId"                                    AS "categoryId",
      c."name"                                          AS name,
      c."color"                                         AS color,
      c."icon"                                          AS icon,
      c."parentId"                                      AS "parentId",
      SUM(COALESCE(t."amountPrimaryMinor", t."amountMinor"))::bigint AS total,
      COUNT(*)                                          AS count
    FROM "Transaction" t
    LEFT JOIN "Category" c
      ON c."id" = t."categoryId" AND c."spaceId" = t."spaceId"
    WHERE t."spaceId" = ${spaceId}
      AND t."deletedAt" IS NULL
      AND t."type" = ${kind}::"TransactionType"
      AND t."date" >= ${from}
      AND t."date" <= ${to}
    GROUP BY 1, 2, 3, 4, 5
    ORDER BY total DESC
  `);

  return rows.map((row) => ({
    categoryId: row.categoryId,
    name: row.name ?? "Sin categoría",
    color: row.color,
    icon: row.icon,
    parentId: row.parentId,
    totalMinor: row.total ?? 0n,
    transactionCount: Number(row.count),
  }));
};

/**
 * Saldo acumulado de todas las cuentas ANTES de una fecha.
 *
 * Es el punto de partida del cash flow: sin él, la curva arrancaría en cero y
 * daría a entender que el patrimonio nació con el primer mes del gráfico.
 *
 * Incluye el saldo de apertura de las cuentas y aplica el signo de cada
 * movimiento, transferencias incluidas —que sí mueven el saldo de una cuenta
 * aunque no sean ingreso ni gasto.
 */
export const balanceBefore = async (
  spaceId: string,
  before: Date,
): Promise<bigint> => {
  const rows = await prisma.$queryRaw<{ total: bigint | null }[]>(Prisma.sql`
    WITH opening AS (
      SELECT COALESCE(SUM("initialBalanceMinor"), 0)::bigint AS total
      FROM "Account"
      WHERE "spaceId" = ${spaceId} AND "deletedAt" IS NULL
    ),
    movements AS (
      SELECT COALESCE(SUM(
        CASE
          WHEN "type" = 'INCOME'  THEN  COALESCE("amountPrimaryMinor", "amountMinor")
          WHEN "type" = 'EXPENSE' THEN -COALESCE("amountPrimaryMinor", "amountMinor")
          WHEN "type" = 'TRANSFER' AND "transferDirection" = 'IN'
                                  THEN  COALESCE("amountPrimaryMinor", "amountMinor")
          WHEN "type" = 'TRANSFER' AND "transferDirection" = 'OUT'
                                  THEN -COALESCE("amountPrimaryMinor", "amountMinor")
          ELSE 0
        END
      ), 0)::bigint AS total
      FROM "Transaction"
      WHERE "spaceId" = ${spaceId}
        AND "deletedAt" IS NULL
        AND "date" < ${before}
    )
    SELECT ((SELECT total FROM opening) + (SELECT total FROM movements))::bigint AS total
  `);

  return rows[0]?.total ?? 0n;
};
