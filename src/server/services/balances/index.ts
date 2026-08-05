import type { ScopedDb } from "@/server/db/scoped";
import { signedAmount } from "@/shared/balance";
import type { MoneyDTO } from "@/shared/contracts/common";

/**
 * Saldos de cuentas.
 *
 * El saldo se CALCULA, no se guarda desnormalizado. La agregación se hace en
 * SQL con `groupBy`, nunca trayendo las filas a memoria: un Space con años de
 * movimientos no entra en un `reduce`.
 *
 * Punto de extensión: si algún día esto se queda corto, entra una
 * implementación con snapshots mensuales detrás de esta misma interfaz sin
 * tocar a quien la llama. Hoy no hace falta y no se agrega complejidad por si
 * acaso.
 */

export interface AccountBalance {
  readonly accountId: string;
  readonly currency: string;
  readonly balanceMinor: bigint;
  readonly transactionCount: number;
}

/**
 * Saldo de todas las cuentas del Space, en la moneda de cada una.
 *
 * Una sola consulta agregada para todas: hacer una por cuenta sería N+1 en el
 * dashboard, que es la pantalla que más se abre.
 */
export const accountBalances = async (
  db: ScopedDb,
  options: { readonly includeArchived?: boolean } = {},
): Promise<Map<string, AccountBalance>> => {
  const accounts = await db.account.findMany({
    where: options.includeArchived === true ? {} : { isArchived: false },
    select: { id: true, currency: true, initialBalanceMinor: true },
  });

  const balances = new Map<string, AccountBalance>(
    accounts.map((account) => [
      account.id,
      {
        accountId: account.id,
        currency: account.currency,
        balanceMinor: account.initialBalanceMinor,
        transactionCount: 0,
      },
    ]),
  );

  if (balances.size === 0) return balances;

  /**
   * Se agrupa por (accountId, type, transferDirection) y se aplica el signo
   * después. Hacerlo así permite que Postgres resuelva todo con el índice
   * (accountId, date) sin traer una sola fila de detalle.
   */
  const grouped = await db.transaction.groupBy({
    by: ["accountId", "type", "transferDirection"],
    where: { accountId: { in: [...balances.keys()] } },
    _sum: { amountMinor: true },
    _count: { _all: true },
  });

  for (const row of grouped) {
    const current = balances.get(row.accountId);
    if (current === undefined) continue;

    /**
     * El signo sale de `movementSign`, la misma función que usa el cálculo de
     * referencia en shared/balance.ts. Duplicar la regla acá sería la forma
     * más fácil de que el saldo del dashboard y el de la lista de cuentas
     * dejaran de coincidir.
     */
    balances.set(row.accountId, {
      ...current,
      balanceMinor:
        current.balanceMinor +
        signedAmount({
          type: row.type,
          amountMinor: row._sum.amountMinor ?? 0n,
          transferDirection: row.transferDirection,
        }),
      transactionCount: current.transactionCount + row._count._all,
    });
  }

  return balances;
};

export const accountBalance = async (
  db: ScopedDb,
  accountId: string,
): Promise<AccountBalance | null> => {
  const balances = await accountBalances(db, { includeArchived: true });
  return balances.get(accountId) ?? null;
};

export const toMoneyDTO = (balance: AccountBalance): MoneyDTO => ({
  amountMinor: balance.balanceMinor.toString(),
  currency: balance.currency,
});
