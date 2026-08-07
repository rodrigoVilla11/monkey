-- Un movimiento respalda como mucho UN pago de deuda.
--
-- Mismo riesgo que en los aportes a metas: vincular dos veces la misma
-- transferencia —a la misma deuda o a dos distintas— contaría la plata dos
-- veces y el saldo pendiente diría que debés menos de lo que debés.
--
-- Parcial porque la mayoría de los pagos se registran a mano, sin movimiento.
--
-- Los IF NOT EXISTS no sobran: Prisma no envuelve el archivo de migración en
-- una transacción, así que un fallo a mitad deja statements aplicados y el
-- reintento choca contra su propio trabajo a medio hacer.
CREATE UNIQUE INDEX IF NOT EXISTS "DebtPayment_one_per_transaction"
  ON "DebtPayment" ("spaceId", "transactionId")
  WHERE "transactionId" IS NOT NULL;

-- No puede haber dos "cuota 3" en la misma deuda.
CREATE UNIQUE INDEX IF NOT EXISTS "DebtPayment_one_per_installment"
  ON "DebtPayment" ("spaceId", "debtId", "installmentNo")
  WHERE "installmentNo" IS NOT NULL;

-- El número de cuota, si viene, es positivo.
DO $$
BEGIN
  ALTER TABLE "DebtPayment"
    ADD CONSTRAINT "DebtPayment_installment_positive"
    CHECK ("installmentNo" IS NULL OR "installmentNo" >= 1);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- La tasa se guarda en basis points y no puede ser negativa. Una deuda sin
-- interés lleva NULL, no cero: son cosas distintas —"no pactamos interés" y
-- "pactamos 0 %"— y el DTO las muestra igual, pero el dato conserva cuál fue.
DO $$
BEGIN
  ALTER TABLE "Debt"
    ADD CONSTRAINT "Debt_interest_non_negative"
    CHECK ("interestRateBps" IS NULL OR "interestRateBps" >= 0);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Las cuotas pactadas, si se pactaron, son al menos una.
DO $$
BEGIN
  ALTER TABLE "Debt"
    ADD CONSTRAINT "Debt_installments_positive"
    CHECK ("installmentsTotal" IS NULL OR "installmentsTotal" >= 1);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
