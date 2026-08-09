-- La forma elegida para llegar a una meta: cuánto apartar y cada cuánto.
--
-- La app propone varias —diaria, semanal, quincenal, mensual, todas calculadas
-- de lo que falta y la fecha objetivo— y esto guarda la que la persona eligió.
-- Guardar la elección y no solo recalcularla es lo que permite decir "te
-- atrasaste dos semanas": sin un compromiso registrado, la propuesta se
-- recalcula sola cada día y nunca se puede ir atrasado.
--
-- Mismas cuatro columnas y mismo enum que el plan de una deuda: las fechas las
-- calcula el mismo motor de recurrencia que los movimientos programados.
ALTER TABLE "SavingsGoal" ADD COLUMN IF NOT EXISTS "planAmountMinor" BIGINT;
ALTER TABLE "SavingsGoal" ADD COLUMN IF NOT EXISTS "planFrequency" "RecurrenceFrequency";
ALTER TABLE "SavingsGoal" ADD COLUMN IF NOT EXISTS "planInterval" INTEGER;
ALTER TABLE "SavingsGoal" ADD COLUMN IF NOT EXISTS "planStartDate" DATE;

-- Los cuatro campos o ninguno. Media fila es un plan a medio escribir: un
-- importe sin frecuencia no dice cuándo y una frecuencia sin importe no dice
-- cuánto. Que lo garantice la base y no solo Zod es lo que hace que un import o
-- un arreglo a mano por psql tampoco puedan dejarlo así.
--
-- Los IF NOT EXISTS y el EXCEPTION no sobran: Prisma no envuelve el archivo en
-- una transacción, así que un fallo a mitad deja statements aplicados y el
-- reintento choca contra su propio trabajo a medio hacer.
DO $$
BEGIN
  ALTER TABLE "SavingsGoal"
    ADD CONSTRAINT "SavingsGoal_plan_all_or_none"
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

-- Apartar cero no llega nunca, y la proyección tendría que dividir por cero
-- para decirlo.
DO $$
BEGIN
  ALTER TABLE "SavingsGoal"
    ADD CONSTRAINT "SavingsGoal_plan_amount_positive"
    CHECK ("planAmountMinor" IS NULL OR "planAmountMinor" > 0);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "SavingsGoal"
    ADD CONSTRAINT "SavingsGoal_plan_interval_sane"
    CHECK ("planInterval" IS NULL OR ("planInterval" >= 1 AND "planInterval" <= 365));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
