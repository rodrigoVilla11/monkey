-- CreateEnum
CREATE TYPE "TransferDirection" AS ENUM ('OUT', 'IN');

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "transferDirection" "TransferDirection";

-- Una transferencia son dos patas: TRANSFER lleva siempre grupo y sentido,
-- y ningún otro tipo los lleva. Sin esto, una pata suelta o un EXPENSE con
-- sentido de transferencia falsearía los saldos en silencio.
ALTER TABLE "Transaction"
  ADD CONSTRAINT "Transaction_transfer_fields_consistent"
  CHECK (
    ("type" = 'TRANSFER'
      AND "transferGroupId" IS NOT NULL
      AND "transferDirection" IS NOT NULL)
    OR
    ("type" <> 'TRANSFER'
      AND "transferGroupId" IS NULL
      AND "transferDirection" IS NULL)
  );

