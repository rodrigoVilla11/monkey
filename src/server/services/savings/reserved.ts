import type { ScopedDb } from "@/server/db/scoped";

/**
 * Lo que hay apartado en cada cuenta.
 *
 * ── Por qué existe ──────────────────────────────────────────────────────────
 *
 * Un aporte no mueve saldos —esa regla no cambia, ver el encabezado de
 * `savings/index.ts`— pero sí cambia lo que ese saldo SIGNIFICA. Con 5.000 € en
 * la cuenta y 1.800 € apartados para el viaje, gastar 4.000 € no es "me queda
 * poco": es quedarse corto para el viaje. El saldo solo no lo dice.
 *
 * Por eso lo apartado se CALCULA acá y no se descuenta del saldo: el saldo es
 * un hecho —lo que el banco tiene— y lo apartado es una intención. Restarlo de
 * verdad haría que la app no cuadrara contra el extracto, que es la única
 * comprobación externa que existe.
 *
 * ── Qué entra y qué no ──────────────────────────────────────────────────────
 *
 *  · Solo las metas con cuenta asignada: sin cuenta no hay a qué imputarlo.
 *  · Solo si la meta está en la MISMA moneda que la cuenta. Sumar una meta en
 *    dólares dentro de una cuenta en euros pediría una cotización inventada, y
 *    se prefiere avisar (`otherCurrencyGoals`) a mostrar un número aproximado.
 *  · Las metas LOGRADAS siguen contando: la plata del viaje sigue apartada
 *    hasta que se gasta —y cuando se gasta, se registra el retiro—. Sacarlas al
 *    marcarlas como logradas liberaría de golpe una plata que no se tocó.
 *  · Una meta con total negativo (más retiros que aportes) cuenta como cero: no
 *    se puede desapartar más de lo que se apartó.
 */

export interface GoalReservation {
  readonly goalId: string;
  readonly name: string;
  readonly color: string | null;
  readonly amountMinor: bigint;
  readonly achieved: boolean;
}

export interface AccountReservation {
  /** Suma de lo apartado, en la moneda de la cuenta. */
  readonly reservedMinor: bigint;
  /** El desglose, de mayor a menor: primero la meta que más pesa. */
  readonly goals: readonly GoalReservation[];
  /**
   * Metas con plata apartada que apuntan a esta cuenta pero están en otra
   * moneda. No se suman; se cuentan para poder decirlo en pantalla.
   */
  readonly otherCurrencyGoals: number;
}

export const NO_RESERVATION: AccountReservation = {
  reservedMinor: 0n,
  goals: [],
  otherCurrencyGoals: 0,
};

interface Bucket {
  reservedMinor: bigint;
  goals: GoalReservation[];
  otherCurrencyGoals: number;
}

/**
 * Lo apartado en cada una de las cuentas que se pasen, en DOS consultas
 * agregadas —las metas y la suma de sus aportes— pase lo que pase.
 *
 * Recibe las cuentas ya leídas en vez de volver a buscarlas: quien llama viene
 * de listar cuentas o el dashboard, y ahí las filas ya están en memoria.
 */
export const reservedByAccount = async (
  db: ScopedDb,
  accounts: readonly { readonly id: string; readonly currency: string }[],
): Promise<Map<string, AccountReservation>> => {
  const result = new Map<string, AccountReservation>();
  if (accounts.length === 0) return result;

  const currencyOf = new Map(
    accounts.map((account) => [account.id, account.currency]),
  );

  const goals = await db.savingsGoal.findMany({
    where: { accountId: { in: [...currencyOf.keys()] } },
    select: {
      id: true,
      name: true,
      color: true,
      currency: true,
      accountId: true,
      achievedAt: true,
    },
  });

  if (goals.length === 0) return result;

  const grouped = await db.savingsContribution.groupBy({
    by: ["goalId"],
    where: { goalId: { in: goals.map((goal) => goal.id) } },
    _sum: { amountMinor: true },
  });

  const savedOf = new Map(
    grouped.map((row) => [row.goalId, row._sum.amountMinor ?? 0n]),
  );

  const buckets = new Map<string, Bucket>();
  const bucketFor = (accountId: string): Bucket => {
    const existing = buckets.get(accountId);
    if (existing !== undefined) return existing;

    const created: Bucket = {
      reservedMinor: 0n,
      goals: [],
      otherCurrencyGoals: 0,
    };
    buckets.set(accountId, created);
    return created;
  };

  for (const goal of goals) {
    // El `where` lo garantiza; el tipo de Prisma lo da nullable igual.
    if (goal.accountId === null) continue;

    const currency = currencyOf.get(goal.accountId);
    if (currency === undefined) continue;

    const amountMinor = savedOf.get(goal.id) ?? 0n;
    // Una meta sin aportes no aparta nada, y no ensucia el desglose con ceros.
    if (amountMinor <= 0n) continue;

    const bucket = bucketFor(goal.accountId);

    if (goal.currency !== currency) {
      bucket.otherCurrencyGoals += 1;
      continue;
    }

    bucket.reservedMinor += amountMinor;
    bucket.goals.push({
      goalId: goal.id,
      name: goal.name,
      color: goal.color,
      amountMinor,
      achieved: goal.achievedAt !== null,
    });
  }

  for (const [accountId, bucket] of buckets) {
    result.set(accountId, {
      reservedMinor: bucket.reservedMinor,
      goals: [...bucket.goals].sort((a, b) =>
        b.amountMinor === a.amountMinor
          ? a.name.localeCompare(b.name)
          : b.amountMinor > a.amountMinor
            ? 1
            : -1,
      ),
      otherCurrencyGoals: bucket.otherCurrencyGoals,
    });
  }

  return result;
};
