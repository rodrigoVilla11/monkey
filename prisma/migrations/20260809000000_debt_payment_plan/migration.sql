-- Plan de pago/cobro de una deuda: cuánto y cada cuánto se acordó.
--
-- Es el ACUERDO, no una cuota calculada. La diferencia es la misma que ya
-- estaba tomada para `interestRateBps`: Monkey no amortiza —no sabe las
-- convenciones de días, comisiones ni seguros del acreedor— pero sí puede
-- guardar lo que dos personas se dijeron ("me paga 300 por mes desde el 5 de
-- marzo") y contrastarlo con los pagos que se registraron de verdad.
--
-- Se reusa el enum de recurrencia que ya existe, con su `interval`, en vez de
-- inventar uno propio: así "quincenal" es WEEKLY cada 2 y las fechas del plan
-- las calcula el MISMO motor que las de los movimientos programados, con su
-- regla de no derivar (el 31 sigue siendo 31 después de febrero).
ALTER TABLE "Debt" ADD COLUMN IF NOT EXISTS "planAmountMinor" BIGINT;
ALTER TABLE "Debt" ADD COLUMN IF NOT EXISTS "planFrequency" "RecurrenceFrequency";
ALTER TABLE "Debt" ADD COLUMN IF NOT EXISTS "planInterval" INTEGER;
ALTER TABLE "Debt" ADD COLUMN IF NOT EXISTS "planStartDate" DATE;

-- Los cuatro campos o ninguno.
--
-- Sin esto, media fila es un plan a medio escribir: un importe sin frecuencia
-- no dice cuándo y una frecuencia sin importe no dice cuánto, y cualquiera de
-- los dos obligaría a cada consumidor a inventar el que falta. Que lo garantice
-- la base y no solo Zod es lo que hace que un import, un script o un arreglo a
-- mano por psql tampoco puedan dejarlo así.
--
-- Los IF NOT EXISTS y el EXCEPTION no sobran: Prisma no envuelve el archivo en
-- una transacción, así que un fallo a mitad deja statements aplicados y el
-- reintento choca contra su propio trabajo a medio hacer.
DO $$
BEGIN
  ALTER TABLE "Debt"
    ADD CONSTRAINT "Debt_plan_all_or_none"
    CHECK (
      (
        "planAmountMinor" IS NULL
        AND "planFrequency" IS NULL
        AND "planInterval" IS NULL
        AND "planStartDate" IS NULL
      )
      OR (
        "planAmountMinor" IS NOT NULL
        AND "planFrequency" IS NOT NULL
        AND "planInterval" IS NOT NULL
        AND "planStartDate" IS NOT NULL
      )
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- La cuota del plan es plata: mayor que cero. Un plan de 0 por mes no salda
-- nunca, y la proyección tendría que dividir por cero para decirlo.
DO $$
BEGIN
  ALTER TABLE "Debt"
    ADD CONSTRAINT "Debt_plan_amount_positive"
    CHECK ("planAmountMinor" IS NULL OR "planAmountMinor" > 0);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- El intervalo, si hay plan, es el mismo rango que acepta el motor de
-- recurrencia. Fuera de ahí las fechas dejan de tener sentido.
DO $$
BEGIN
  ALTER TABLE "Debt"
    ADD CONSTRAINT "Debt_plan_interval_sane"
    CHECK ("planInterval" IS NULL OR ("planInterval" >= 1 AND "planInterval" <= 365));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
