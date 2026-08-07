-- Una transferencia es un par: como mucho una pata de salida y una de entrada
-- por grupo. Sin esto, un bug en el service o dos peticiones simultáneas
-- podrían dejar tres patas en el mismo grupo y descuadrar los saldos sin que
-- nada se queje.
--
-- Parcial por `deletedAt`: al borrar una transferencia las dos patas quedan
-- con borrado lógico, y el índice tiene que dejar crear una nueva con otro
-- grupo sin chocar con las viejas.
CREATE UNIQUE INDEX "Transaction_one_leg_per_direction"
  ON "Transaction" ("transferGroupId", "transferDirection")
  WHERE "transferGroupId" IS NOT NULL AND "deletedAt" IS NULL;

-- Mover plata entre dos cuentas propias no es un gasto ni un ingreso, así que
-- no tiene categoría. Categorizarla la haría aparecer en el desglose por
-- categoría inflando el gasto del período con plata que nunca salió del
-- patrimonio.
ALTER TABLE "Transaction"
  ADD CONSTRAINT "Transaction_transfer_has_no_category"
  CHECK ("type" <> 'TRANSFER' OR "categoryId" IS NULL);
