-- Presupuestos por cuenta.
--
-- Hasta ahora un presupuesto solo se podía acotar por categoría, así que un
-- tope siempre miraba TODA la plata del Space. No había forma de decir "500 de
-- comida con las tarjetas" y "200 de comida en efectivo": eran dos topes sobre
-- la misma categoría, y el service lo rechazaba.
--
-- El alcance por cuentas es una tabla aparte y no una columna: un presupuesto
-- alcanza N cuentas, y guardarlo como lista en una columna haría imposible el
-- borrado en cascada cuando se elimina una cuenta.

-- Destino de la FK compuesta de abajo. Las FKs dentro de un Space son siempre
-- (spaceId, id) para que la base impida referenciar una fila de otro Space:
-- ver la nota al pie de schema.prisma.
CREATE UNIQUE INDEX IF NOT EXISTS "Budget_spaceId_id_key" ON "Budget"("spaceId", "id");

CREATE TABLE IF NOT EXISTS "BudgetAccount" (
    "budgetId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BudgetAccount_pkey" PRIMARY KEY ("budgetId","accountId")
);

-- Para resolver "qué presupuestos toca esta cuenta" sin recorrer la tabla, y
-- para el borrado en cascada al eliminar una cuenta.
CREATE INDEX IF NOT EXISTS "BudgetAccount_spaceId_accountId_idx"
  ON "BudgetAccount"("spaceId", "accountId");

ALTER TABLE "BudgetAccount"
  ADD CONSTRAINT "BudgetAccount_spaceId_budgetId_fkey"
  FOREIGN KEY ("spaceId", "budgetId") REFERENCES "Budget"("spaceId", "id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BudgetAccount"
  ADD CONSTRAINT "BudgetAccount_spaceId_accountId_fkey"
  FOREIGN KEY ("spaceId", "accountId") REFERENCES "Account"("spaceId", "id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BudgetAccount"
  ADD CONSTRAINT "BudgetAccount_spaceId_fkey"
  FOREIGN KEY ("spaceId") REFERENCES "Space"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Los presupuestos existentes no reciben ninguna fila: sin filas significa
-- "todas las cuentas", que es exactamente lo que hacían hasta hoy.
