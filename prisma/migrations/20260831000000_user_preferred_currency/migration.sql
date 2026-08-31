-- Moneda preferida por persona. Hasta ahora la moneda "principal" que veía todo
-- el mundo salía de DEFAULT_CURRENCY del entorno (EUR) fijada al registrarse, y
-- no había forma de elegir otra desde la app.
--
-- La preferencia vive en User y no en Space a propósito: la moneda de
-- consolidación de un Space (Space.primaryCurrency) sigue siendo inmutable
-- porque las transacciones guardan conversiones congeladas contra ella. Esta
-- columna solo decide qué moneda se PROPONE por defecto al crear Spaces,
-- cuentas y deudas.
--
-- Default 'EUR': todos los usuarios existentes se registraron con ese default,
-- así que el backfill no cambia nada de lo que ven hoy.
ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "preferredCurrency" CHAR(3) NOT NULL DEFAULT 'EUR';
