import { allocate, money, type Money } from "./money";

/**
 * Reparto de gastos entre miembros. Lógica pura, sin base de datos.
 *
 * ── Qué es un reparto y qué NO es ───────────────────────────────────────────
 *
 * Un reparto es una **anotación** sobre un gasto: "de estos 120 €, 60 son míos
 * y 60 tuyos". No genera una deuda por cada gasto — cincuenta cenas serían
 * cincuenta deudas de siete euros que nadie salda una por una. Lo que hace
 * falta es un número por persona, y eso se calcula agregando.
 *
 * ── La invariante ───────────────────────────────────────────────────────────
 *
 * **La suma de las partes es exactamente el importe.** Ni un céntimo de más ni
 * de menos. Repartir 10 € entre 3 con una división normal da 3,33 tres veces y
 * pierde un céntimo; `allocate` lo reparte y se lo da a la primera parte.
 *
 * Módulo puro: sin Next, sin Prisma, sin React.
 */

export interface Share {
  readonly userId: string;
  readonly amountMinor: bigint;
}

export type SplitError =
  | "NO_PARTICIPANTS"
  | "DUPLICATE_PARTICIPANT"
  | "SUM_MISMATCH"
  | "NON_POSITIVE"
  | "INVALID_PERCENTAGE";

export type SplitResult =
  | { readonly ok: true; readonly shares: readonly Share[] }
  | { readonly ok: false; readonly error: SplitError };

/**
 * Reparto en partes iguales.
 *
 * Los céntimos que sobran van a las primeras partes, de a uno. Es arbitrario
 * pero determinista: repartir 10 € entre 3 da 3,34 / 3,33 / 3,33 y la suma es
 * 10,00 exactos. La alternativa —redondear cada parte por su cuenta— pierde o
 * inventa céntimos, que en un reparto entre personas se nota.
 */
export const splitEvenly = (
  total: Money,
  userIds: readonly string[],
): SplitResult => {
  if (userIds.length === 0) return { ok: false, error: "NO_PARTICIPANTS" };
  if (new Set(userIds).size !== userIds.length) {
    return { ok: false, error: "DUPLICATE_PARTICIPANT" };
  }
  if (total.amountMinor <= 0n) return { ok: false, error: "NON_POSITIVE" };

  const parts = allocate(total, userIds.length);
  if (!parts.ok) return { ok: false, error: "NON_POSITIVE" };

  return {
    ok: true,
    shares: userIds.map((userId, index) => ({
      userId,
      amountMinor: parts.value[index]?.amountMinor ?? 0n,
    })),
  };
};

/**
 * Reparto por porcentajes, en basis points para no meter floats.
 *
 * Los porcentajes tienen que sumar exactamente 10.000 bps (100 %). El
 * redondeo de cada parte deja un resto que se le da a la primera: sin eso, tres
 * partes del 33,33 % de 10 € darían 9,99.
 */
export const splitByPercentage = (
  total: Money,
  weights: readonly { readonly userId: string; readonly bps: number }[],
): SplitResult => {
  if (weights.length === 0) return { ok: false, error: "NO_PARTICIPANTS" };
  if (new Set(weights.map((w) => w.userId)).size !== weights.length) {
    return { ok: false, error: "DUPLICATE_PARTICIPANT" };
  }
  if (total.amountMinor <= 0n) return { ok: false, error: "NON_POSITIVE" };

  const sum = weights.reduce((acc, weight) => acc + weight.bps, 0);
  if (sum !== 10_000 || weights.some((w) => w.bps <= 0)) {
    return { ok: false, error: "INVALID_PERCENTAGE" };
  }

  const shares: Share[] = weights.map((weight) => ({
    userId: weight.userId,
    // División entera: siempre por debajo, nunca por encima.
    amountMinor: (total.amountMinor * BigInt(weight.bps)) / 10_000n,
  }));

  const assigned = shares.reduce((acc, share) => acc + share.amountMinor, 0n);
  const remainder = total.amountMinor - assigned;

  // El resto va a la primera parte. Es determinista y la suma cuadra.
  const first = shares[0];
  if (first !== undefined && remainder !== 0n) {
    shares[0] = { ...first, amountMinor: first.amountMinor + remainder };
  }

  return { ok: true, shares };
};

/**
 * Valida un reparto escrito a mano.
 *
 * No lo corrige: si alguien puso importes que no suman, hay que decírselo. Un
 * ajuste silencioso cambiaría lo que la persona quiso repartir.
 */
export const validateShares = (
  total: Money,
  shares: readonly Share[],
): SplitResult => {
  if (shares.length === 0) return { ok: false, error: "NO_PARTICIPANTS" };
  if (new Set(shares.map((s) => s.userId)).size !== shares.length) {
    return { ok: false, error: "DUPLICATE_PARTICIPANT" };
  }
  if (shares.some((share) => share.amountMinor <= 0n)) {
    return { ok: false, error: "NON_POSITIVE" };
  }

  const sum = shares.reduce((acc, share) => acc + share.amountMinor, 0n);
  if (sum !== total.amountMinor) return { ok: false, error: "SUM_MISMATCH" };

  return { ok: true, shares };
};

// ─────────────────────────────── el neteo ────────────────────────────────────

export interface MemberFlow {
  readonly userId: string;
  /** Lo que puso de su bolsillo. */
  readonly paidMinor: bigint;
  /** Lo que le tocaba según los repartos. */
  readonly owedMinor: bigint;
}

export interface MemberBalance {
  readonly userId: string;
  readonly paidMinor: bigint;
  readonly owedMinor: bigint;
  /**
   * paid − owed, más lo saldado. Positivo = le deben; negativo = debe.
   * La suma de todos los saldos es SIEMPRE cero.
   */
  readonly netMinor: bigint;
}

export interface Settlement {
  readonly fromUserId: string;
  readonly toUserId: string;
  readonly amountMinor: bigint;
}

/**
 * Saldo de cada miembro: lo que puso menos lo que le tocaba, ajustado por lo
 * que ya se saldó.
 *
 * La suma de todos los saldos da cero por construcción, y hay un test de eso:
 * es la comprobación de que no se inventó ni se perdió plata en el camino.
 */
export const memberBalances = (
  flows: readonly MemberFlow[],
  settlements: readonly Settlement[],
): MemberBalance[] => {
  const net = new Map<string, bigint>();

  for (const flow of flows) {
    net.set(flow.userId, flow.paidMinor - flow.owedMinor);
  }

  /**
   * Un saldado es plata que ya cambió de manos: quien pagó deja de deber, quien
   * cobró deja de que le deban. Se aplica como si fuera un gasto más que puso
   * el que paga.
   */
  for (const settlement of settlements) {
    net.set(
      settlement.fromUserId,
      (net.get(settlement.fromUserId) ?? 0n) + settlement.amountMinor,
    );
    net.set(
      settlement.toUserId,
      (net.get(settlement.toUserId) ?? 0n) - settlement.amountMinor,
    );
  }

  const byUser = new Map(flows.map((flow) => [flow.userId, flow]));

  return (
    [...net.entries()]
      .map(([userId, netMinor]) => ({
        userId,
        paidMinor: byUser.get(userId)?.paidMinor ?? 0n,
        owedMinor: byUser.get(userId)?.owedMinor ?? 0n,
        netMinor,
      }))
      // Quien más debe primero: es el orden en que uno mira la lista.
      .sort((a, b) =>
        a.netMinor < b.netMinor ? -1 : a.netMinor > b.netMinor ? 1 : 0,
      )
  );
};

/**
 * Quién le tiene que pagar a quién, con el mínimo de transferencias.
 *
 * El algoritmo es el codicioso de siempre: se empareja al que más debe con el
 * que más le deben, se salda lo que se pueda, y se repite. Con N personas deja
 * como mucho N−1 pagos, que es el mínimo posible en el caso general.
 *
 * Importa más de lo que parece: sin esto, cuatro personas con seis deudas
 * cruzadas tendrían que hacer seis transferencias en vez de tres. Y quien
 * mira la pantalla quiere una instrucción, no un balance contable.
 */
export const settleUp = (balances: readonly MemberBalance[]): Settlement[] => {
  const debtors = balances
    .filter((balance) => balance.netMinor < 0n)
    .map((balance) => ({ userId: balance.userId, amount: -balance.netMinor }))
    .sort((a, b) => (a.amount > b.amount ? -1 : 1));

  const creditors = balances
    .filter((balance) => balance.netMinor > 0n)
    .map((balance) => ({ userId: balance.userId, amount: balance.netMinor }))
    .sort((a, b) => (a.amount > b.amount ? -1 : 1));

  const payments: Settlement[] = [];
  let d = 0;
  let c = 0;

  while (d < debtors.length && c < creditors.length) {
    const debtor = debtors[d];
    const creditor = creditors[c];
    if (debtor === undefined || creditor === undefined) break;

    const amount =
      debtor.amount < creditor.amount ? debtor.amount : creditor.amount;

    if (amount > 0n) {
      payments.push({
        fromUserId: debtor.userId,
        toUserId: creditor.userId,
        amountMinor: amount,
      });
    }

    debtor.amount -= amount;
    creditor.amount -= amount;

    if (debtor.amount === 0n) d += 1;
    if (creditor.amount === 0n) c += 1;
  }

  return payments;
};

/** Atajo para armar un `Money` desde los datos de un reparto. */
export const shareMoney = (share: Share, currency: string): Money =>
  money(share.amountMinor, currency);
