-- Archivar una categoría: que deje de ofrecerse al cargar, sin tocar el pasado.
--
-- Hasta ahora la única forma de sacar una categoría de la lista era borrarla, y
-- borrar reasigna —o deja en NULL— la categoría de todos los movimientos que la
-- usaban. O sea: la única manera de dejar de usar "Taxi" era reescribir en qué
-- se gastó el año pasado. Son dos cosas distintas y ahora se pueden decir por
-- separado:
--
--   · archivar → no aparece al cargar; el historial y los reportes intactos.
--   · borrar   → la categoría fue un error y sus movimientos se reasignan.
--
-- Por defecto FALSE: todo lo que ya existe se comporta exactamente igual que
-- antes de esta migración.
ALTER TABLE "Category"
  ADD COLUMN IF NOT EXISTS "isArchived" BOOLEAN NOT NULL DEFAULT false;

-- El selector de categorías se abre en cada carga de movimiento y filtra por
-- (spaceId, kind, isArchived). Es la consulta más caliente de la tabla.
CREATE INDEX IF NOT EXISTS "Category_spaceId_kind_isArchived_idx"
  ON "Category" ("spaceId", "kind", "isArchived")
  WHERE "deletedAt" IS NULL;
