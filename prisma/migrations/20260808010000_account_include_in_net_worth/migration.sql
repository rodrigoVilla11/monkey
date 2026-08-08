-- Si una cuenta cuenta para el inicio: aparece en la lista del dashboard Y suma
-- al patrimonio neto.
--
-- Es UN interruptor y no dos —"ocultar" y "no sumar" por separado— a propósito:
-- una cuenta escondida que igual moviera el total dejaría un patrimonio que no
-- se puede explicar mirando la pantalla.
--
-- Por defecto TRUE: todo lo que ya existe se comporta exactamente igual que
-- antes de esta migración. Un default false habría vaciado el inicio de todo el
-- mundo en el despliegue.
ALTER TABLE "Account"
  ADD COLUMN IF NOT EXISTS "includeInNetWorth" BOOLEAN NOT NULL DEFAULT true;

-- El dashboard filtra por (spaceId, isArchived, includeInNetWorth) en cada
-- carga, que es la pantalla que más se abre de la app.
CREATE INDEX IF NOT EXISTS "Account_spaceId_includeInNetWorth_idx"
  ON "Account" ("spaceId", "includeInNetWorth")
  WHERE "deletedAt" IS NULL;
