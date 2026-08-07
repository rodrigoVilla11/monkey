-- Un movimiento respalda como mucho UN aporte.
--
-- Sin esto, vincular dos veces la misma transferencia a la misma meta —o a dos
-- metas distintas— contaría la plata dos veces y la barra de progreso diría que
-- ahorraste el doble de lo que hay en la cuenta.
--
-- Parcial porque la mayoría de los aportes no vienen de un movimiento: se
-- registran a mano.
--
-- El IF NOT EXISTS no sobra: Prisma no envuelve el archivo de migración en una
-- transacción, así que un fallo a mitad deja statements aplicados.
CREATE UNIQUE INDEX IF NOT EXISTS "SavingsContribution_one_per_transaction"
  ON "SavingsContribution" ("spaceId", "transactionId")
  WHERE "transactionId" IS NOT NULL;

-- La fecha del aporte no puede ser anterior a la creación de la meta por
-- accidente de tipeo, pero sí puede serlo a propósito (cargar lo que ya venías
-- ahorrando), así que no hay CHECK de fecha. Lo que sí se garantiza es que el
-- importe no sea cero: un aporte de cero no aporta y ensucia el historial.
-- (Ya viene de la migración inicial como SavingsContribution_amount_non_zero.)
