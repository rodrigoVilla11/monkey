import { z } from "zod";

import {
  amountMinorSchema,
  calendarDateSchema,
  cuidSchema,
  type MoneyDTO,
} from "./common";
import { exchangeRateSchema } from "./transactions";

/**
 * Importe de una transferencia: positivo de verdad, no solo no negativo.
 *
 * `amountMinorSchema` admite el cero porque un movimiento en cero es raro pero
 * legítimo (un ajuste, un apunte informativo). Una transferencia en cero no:
 * no mueve nada y deja dos filas que ensucian el listado y los saldos.
 */
const transferAmountSchema = amountMinorSchema.refine(
  // El guard de dígitos no sobra: Zod 4 corre los refinements aunque el regex
  // de `amountMinorSchema` ya haya fallado, y `BigInt("10.50")` lanza un
  // SyntaxError. Sin esto, un importe mal escrito daría 500 en vez de 400.
  (value) => /^\d+$/.test(value) && BigInt(value) > 0n,
  "El importe tiene que ser mayor que cero",
);

/**
 * Transferencias entre cuentas del mismo Space.
 *
 * Una transferencia son DOS transacciones con el mismo `transferGroupId`: la
 * que sale (OUT) y la que entra (IN). Tienen endpoint propio porque crear una
 * sola pata dejaría los saldos descuadrados, y por eso el endpoint de
 * transacciones no acepta el tipo TRANSFER.
 *
 * **La decisión que importa: entre monedas distintas se piden los DOS
 * importes, no un importe y una cotización.** Cuando uno mueve euros a una
 * cuenta en pesos, el banco no aplica la cotización publicada: aplica la suya y
 * cobra comisión. Si el importe de destino se calculara a partir de una
 * cotización, el saldo de la cuenta receptora quedaría mal por la diferencia y
 * no habría forma de cuadrarlo contra el extracto. Diciendo cuánto salió y
 * cuánto llegó, la cotización REAL de la operación sale sola —y es esa, no la
 * del mercado, la que se congela.
 *
 * Módulo puro: sin Next, sin Prisma, sin React.
 */

export const createTransferRequestSchema = z
  .object({
    fromAccountId: cuidSchema,
    toAccountId: cuidSchema,
    /** Lo que sale de la cuenta de origen, en la moneda de esa cuenta. */
    amountOutMinor: transferAmountSchema,
    /**
     * Lo que entra en la cuenta de destino, en la moneda de esa cuenta.
     *
     * Obligatorio solo si las dos cuentas tienen monedas distintas. Si son
     * iguales se ignora: no puede entrar un importe distinto del que salió.
     */
    amountInMinor: transferAmountSchema.optional(),
    /** Si no viene, el servidor usa "hoy" en la timezone de quien carga. */
    date: calendarDateSchema.optional(),
    description: z.string().trim().max(200).nullable().optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
    /**
     * Cotización de la moneda de ORIGEN a la primaria del Space, para el caso
     * en que ninguna de las dos cuentas esté en la moneda primaria. En el resto
     * de los casos se ignora: la conversión sale de la propia transferencia.
     */
    exchangeRate: exchangeRateSchema.optional(),
  })
  .refine(
    (value) => value.fromAccountId !== value.toAccountId,
    "El origen y el destino tienen que ser cuentas distintas",
  );

/**
 * Edición: se reemplaza la transferencia entera, no una pata.
 *
 * Cambiar un solo lado descuadraría el par, así que se vuelven a resolver
 * importes, cuentas y conversión de las dos patas dentro de una transacción de
 * base. Los IDs de las filas y el grupo se conservan.
 */
export const updateTransferRequestSchema = z
  .object({
    fromAccountId: cuidSchema.optional(),
    toAccountId: cuidSchema.optional(),
    amountOutMinor: transferAmountSchema.optional(),
    amountInMinor: transferAmountSchema.optional(),
    date: calendarDateSchema.optional(),
    description: z.string().trim().max(200).nullable().optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
    exchangeRate: exchangeRateSchema.optional(),
  })
  .refine(
    (value) => Object.keys(value).length > 0,
    "Hay que mandar al menos un campo",
  )
  .refine(
    (value) =>
      value.fromAccountId === undefined ||
      value.toAccountId === undefined ||
      value.fromAccountId !== value.toAccountId,
    "El origen y el destino tienen que ser cuentas distintas",
  );

export type CreateTransferRequest = z.infer<typeof createTransferRequestSchema>;
export type UpdateTransferRequest = z.infer<typeof updateTransferRequestSchema>;

// ────────────────────────────── respuestas ───────────────────────────────────

export interface TransferAccountDTO {
  readonly id: string;
  readonly name: string;
  readonly color: string | null;
  readonly icon: string | null;
  readonly currency: string;
}

export interface TransferDTO {
  /** El `transferGroupId`: es el identificador de la transferencia. */
  readonly id: string;
  readonly from: TransferAccountDTO;
  readonly to: TransferAccountDTO;
  readonly amountOut: MoneyDTO;
  readonly amountIn: MoneyDTO;
  /**
   * Valor de la transferencia en la moneda primaria del Space. Es el MISMO
   * para las dos patas por construcción: una transferencia no puede cambiar el
   * patrimonio del Space.
   */
  readonly amountPrimary: MoneyDTO;
  /**
   * Cotización real de la operación (1 unidad de origen = N de destino).
   * `null` cuando las dos cuentas comparten moneda.
   */
  readonly rate: string | null;
  readonly date: string;
  readonly description: string | null;
  readonly notes: string | null;
  readonly author: {
    readonly userId: string | null;
    readonly name: string;
    readonly avatarUrl: string | null;
  };
  /** IDs de las dos transacciones que la componen. */
  readonly legIds: readonly [string, string];
  readonly createdAt: string;
}
