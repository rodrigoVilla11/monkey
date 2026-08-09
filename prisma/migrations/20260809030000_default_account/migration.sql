-- Cuenta principal: la que viene elegida al cargar un movimiento.
--
-- Hasta ahora la pantalla de carga proponía "la primera de la lista", que es un
-- orden arbitrario: cambiar el nombre de una cuenta podía cambiar de dónde
-- salía la plata por defecto. Ahora es una decisión explícita.
ALTER TABLE "Account"
  ADD COLUMN IF NOT EXISTS "isDefault" BOOLEAN NOT NULL DEFAULT false;

-- UNA sola principal por Space, garantizado por la base.
--
-- Es un índice único PARCIAL: solo indexa las filas con isDefault = true, así
-- que las demás no se estorban entre sí. Sin esto, "poner esta como principal"
-- tendría que sacarle la marca a la anterior en el service y confiar en que
-- nadie escriba nunca por otro camino — un import, un script, un psql a mano.
-- Con dos principales, cada pantalla elegiría una distinta y no habría forma de
-- explicar por qué.
--
-- Las archivadas y las borradas quedan fuera del índice: no se ofrecen al
-- cargar, así que su marca no compite. El service igual se la saca al
-- archivarlas, para que al desarchivar no reaparezca una principal fantasma.
CREATE UNIQUE INDEX IF NOT EXISTS "Account_one_default_per_space"
  ON "Account" ("spaceId")
  WHERE "isDefault" AND NOT "isArchived" AND "deletedAt" IS NULL;

-- La primera cuenta de cada Space queda como principal: es lo que la pantalla
-- ya venía proponiendo de hecho, así que nadie ve un cambio de comportamiento
-- al desplegar. Sin esto, todos los Spaces existentes se quedarían sin
-- principal hasta que alguien entrara a elegir una.
UPDATE "Account" a
SET "isDefault" = true
WHERE a."id" = (
  SELECT b."id"
  FROM "Account" b
  WHERE b."spaceId" = a."spaceId"
    AND NOT b."isArchived"
    AND b."deletedAt" IS NULL
  ORDER BY b."sortOrder" ASC, b."createdAt" ASC
  LIMIT 1
);
