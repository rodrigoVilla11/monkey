-- Un programado puede no tener cuenta: la cuenta se elige al aceptar cada
-- ocurrencia. Es para lo que se paga desde donde haya plata ese mes —la cuota
-- que un mes sale del banco y otro del efectivo—: la regla avisa que venció y
-- en ese momento se dice de qué cuenta salió.
--
-- El job de materialización no toca las reglas sin cuenta (no habría dónde
-- asentar el movimiento), así que quedan vencidas hasta que alguien las
-- acepta eligiendo cuenta. Por lo mismo, una regla sin cuenta no puede darse
-- por hecha sola: el CHECK lo garantiza en la base, no solo en la API.
--
-- La FK compuesta (spaceId, accountId) sigue valiendo: con accountId NULL,
-- Postgres (MATCH SIMPLE) la da por cumplida.
ALTER TABLE "RecurringRule" ALTER COLUMN "accountId" DROP NOT NULL;

ALTER TABLE "RecurringRule"
  ADD CONSTRAINT "RecurringRule_account_or_manual"
  CHECK ("accountId" IS NOT NULL OR "autoPost" = false);
