-- Una regla recurrente no puede generar dos veces la misma fecha.
--
-- Es LA garantía de idempotencia del job de materialización. El job corre por
-- cron: puede dispararse dos veces por un reintento, por dos instancias del
-- contenedor o por alguien tocando el endpoint a mano mientras el cron corre.
-- Sin esto, cada disparo de más duplica el alquiler del mes y el saldo queda
-- mal sin que nada se queje.
--
-- El motor de recurrencia nunca produce la misma fecha dos veces para una
-- regla, así que el índice no bloquea nada legítimo.
--
-- Parcial por `deletedAt`: si alguien borra una ocurrencia materializada, el
-- hueco queda libre. Y parcial por `recurringRuleId` porque la enorme mayoría
-- de las transacciones no vienen de una regla.
--
-- Los IF NOT EXISTS no sobran: Prisma NO envuelve el archivo de migración en
-- una transacción, así que si un statement falla los anteriores quedan
-- aplicados y el reintento choca contra su propio trabajo a medio hacer.
CREATE UNIQUE INDEX IF NOT EXISTS "Transaction_one_occurrence_per_rule_date"
  ON "Transaction" ("spaceId", "recurringRuleId", "date")
  WHERE "recurringRuleId" IS NOT NULL AND "deletedAt" IS NULL;

-- Una regla recurrente no genera transferencias: no tiene cuenta de destino.
-- Aceptar TRANSFER dejaría patas sueltas, que es justo lo que el módulo de
-- transferencias existe para impedir.
--
-- (El intervalo >= 1 y los rangos de byMonthDay/byWeekday/byMonth ya vienen de
-- la migración inicial: el job depende de los dos, pero no hace falta
-- repetirlos.)
DO $$
BEGIN
  ALTER TABLE "RecurringRule"
    ADD CONSTRAINT "RecurringRule_not_transfer"
    CHECK ("type" <> 'TRANSFER');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
