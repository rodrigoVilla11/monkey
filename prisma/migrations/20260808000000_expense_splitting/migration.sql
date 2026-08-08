-- ── Quién puso la plata ─────────────────────────────────────────────────────
--
-- No es lo mismo que quién cargó el movimiento. En un Space compartido, que
-- Ana anote la cena no dice nada de quién la pagó, y sin ese dato "quién le
-- debe a quién" no se puede calcular.
--
-- NULL = lo pagó el Space (una cuenta común) y no hay nada que repartir. Es el
-- valor de todo lo que ya está cargado, que es exactamente lo correcto: nadie
-- registró hasta ahora quién ponía.
ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "paidByUserId" TEXT;

DO $$
BEGIN
  ALTER TABLE "Transaction"
    ADD CONSTRAINT "Transaction_paidByUserId_fkey"
    FOREIGN KEY ("paidByUserId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "Transaction_spaceId_paidByUserId_date_idx"
  ON "Transaction" ("spaceId", "paidByUserId", "date");

-- ── El reparto ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "TransactionSplit" (
  "id"            TEXT NOT NULL,
  "spaceId"       TEXT NOT NULL,
  "transactionId" TEXT NOT NULL,
  "userId"        TEXT NOT NULL,
  "amountMinor"   BIGINT NOT NULL,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL,

  CONSTRAINT "TransactionSplit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "TransactionSplit_spaceId_transactionId_idx"
  ON "TransactionSplit" ("spaceId", "transactionId");
CREATE INDEX IF NOT EXISTS "TransactionSplit_spaceId_userId_idx"
  ON "TransactionSplit" ("spaceId", "userId");

-- Un miembro aparece como mucho UNA vez por movimiento. Dos filas del mismo
-- usuario en el mismo gasto harían que la suma de los repartos dejara de
-- cuadrar con el importe, que es la única invariante del reparto.
CREATE UNIQUE INDEX IF NOT EXISTS "TransactionSplit_one_per_user_per_transaction"
  ON "TransactionSplit" ("transactionId", "userId");

-- FK COMPUESTA contra (spaceId, id): es la garantía de que un reparto no puede
-- apuntar a un movimiento de otro Space. Misma regla que el resto del dominio.
DO $$
BEGIN
  ALTER TABLE "TransactionSplit"
    ADD CONSTRAINT "TransactionSplit_spaceId_fkey"
    FOREIGN KEY ("spaceId") REFERENCES "Space"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "TransactionSplit"
    ADD CONSTRAINT "TransactionSplit_spaceId_transactionId_fkey"
    FOREIGN KEY ("spaceId", "transactionId")
    REFERENCES "Transaction"("spaceId", "id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "TransactionSplit"
    ADD CONSTRAINT "TransactionSplit_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Una parte de cero no reparte nada y ensucia la lista; una negativa no
-- significa nada en un reparto.
DO $$
BEGIN
  ALTER TABLE "TransactionSplit"
    ADD CONSTRAINT "TransactionSplit_amount_positive"
    CHECK ("amountMinor" > 0);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ── El saldado ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "Settlement" (
  "id"              TEXT NOT NULL,
  "spaceId"         TEXT NOT NULL,
  "fromUserId"      TEXT NOT NULL,
  "toUserId"        TEXT NOT NULL,
  "amountMinor"     BIGINT NOT NULL,
  "currency"        CHAR(3) NOT NULL,
  "date"            DATE NOT NULL,
  "note"            TEXT,
  "createdByUserId" TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Settlement_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Settlement_spaceId_date_idx"
  ON "Settlement" ("spaceId", "date");

DO $$
BEGIN
  ALTER TABLE "Settlement"
    ADD CONSTRAINT "Settlement_spaceId_fkey"
    FOREIGN KEY ("spaceId") REFERENCES "Space"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "Settlement"
    ADD CONSTRAINT "Settlement_fromUserId_fkey"
    FOREIGN KEY ("fromUserId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "Settlement"
    ADD CONSTRAINT "Settlement_toUserId_fkey"
    FOREIGN KEY ("toUserId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "Settlement"
    ADD CONSTRAINT "Settlement_amount_positive"
    CHECK ("amountMinor" > 0);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Nadie se salda cuentas consigo mismo.
DO $$
BEGIN
  ALTER TABLE "Settlement"
    ADD CONSTRAINT "Settlement_distinct_parties"
    CHECK ("fromUserId" <> "toUserId");
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "Settlement"
    ADD CONSTRAINT "Settlement_currency_iso4217"
    CHECK ("currency" SIMILAR TO '[A-Z][A-Z][A-Z]');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
