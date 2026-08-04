-- CreateEnum
CREATE TYPE "MembershipRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER', 'VIEWER');

-- CreateEnum
CREATE TYPE "VerificationType" AS ENUM ('EMAIL_VERIFICATION', 'PASSWORD_RESET');

-- CreateEnum
CREATE TYPE "ThemePreference" AS ENUM ('SYSTEM', 'LIGHT', 'DARK');

-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('CASH', 'BANK', 'CREDIT_CARD', 'INVESTMENT', 'CRYPTO', 'OTHER');

-- CreateEnum
CREATE TYPE "CategoryKind" AS ENUM ('INCOME', 'EXPENSE');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('INCOME', 'EXPENSE', 'TRANSFER');

-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('PENDING', 'CLEARED');

-- CreateEnum
CREATE TYPE "BudgetPeriod" AS ENUM ('MONTHLY', 'WEEKLY', 'CUSTOM');

-- CreateEnum
CREATE TYPE "RecurrenceFrequency" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "DebtDirection" AS ENUM ('OWED_TO_ME', 'OWED_BY_ME');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('SPACE_CREATED', 'SPACE_UPDATED', 'SPACE_DELETED', 'SPACE_OWNERSHIP_TRANSFERRED', 'MEMBER_INVITED', 'INVITATION_REVOKED', 'INVITATION_ACCEPTED', 'MEMBER_ROLE_CHANGED', 'MEMBER_REMOVED', 'MEMBER_LEFT', 'ACCOUNT_CREATED', 'ACCOUNT_UPDATED', 'ACCOUNT_DELETED', 'ACCOUNT_ARCHIVED', 'CATEGORY_DELETED', 'TRANSACTIONS_BULK_DELETED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "timezone" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "emailVerifiedAt" TIMESTAMP(3),
    "theme" "ThemePreference" NOT NULL DEFAULT 'SYSTEM',
    "weekStartsOn" INTEGER NOT NULL DEFAULT 1,
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "sessionsRevokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Space" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "primaryCurrency" CHAR(3) NOT NULL,
    "timezone" TEXT NOT NULL,
    "icon" TEXT,
    "color" TEXT,
    "isPersonal" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Space_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "role" "MembershipRole" NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "invitedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invitation" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "MembershipRole" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "invitedByUserId" TEXT,
    "acceptedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "deviceLabel" TEXT,
    "userAgent" TEXT,
    "ipHash" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "replacedByTokenId" TEXT,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "type" "VerificationType" NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VerificationToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT,
    "actorUserId" TEXT,
    "actorName" TEXT NOT NULL,
    "action" "AuditAction" NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "metadata" JSONB,
    "ipHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "AccountType" NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "initialBalanceMinor" BIGINT NOT NULL DEFAULT 0,
    "color" TEXT,
    "icon" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "creditClosingDay" INTEGER,
    "creditDueDay" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "parentId" TEXT,
    "name" TEXT NOT NULL,
    "kind" "CategoryKind" NOT NULL,
    "icon" TEXT,
    "color" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "categoryId" TEXT,
    "createdByUserId" TEXT,
    "createdByName" TEXT NOT NULL,
    "type" "TransactionType" NOT NULL,
    "status" "TransactionStatus" NOT NULL DEFAULT 'CLEARED',
    "amountMinor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "exchangeRateSnapshot" DECIMAL(24,12),
    "amountPrimaryMinor" BIGINT,
    "date" DATE NOT NULL,
    "description" TEXT,
    "notes" TEXT,
    "payee" TEXT,
    "transferGroupId" TEXT,
    "recurringRuleId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tag" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransactionTag" (
    "transactionId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TransactionTag_pkey" PRIMARY KEY ("transactionId","tagId")
);

-- CreateTable
CREATE TABLE "Budget" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "categoryId" TEXT,
    "name" TEXT NOT NULL,
    "period" "BudgetPeriod" NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "rollover" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Budget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecurringRule" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "categoryId" TEXT,
    "createdByUserId" TEXT,
    "createdByName" TEXT NOT NULL,
    "type" "TransactionType" NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "description" TEXT,
    "payee" TEXT,
    "frequency" "RecurrenceFrequency" NOT NULL,
    "interval" INTEGER NOT NULL DEFAULT 1,
    "byMonthDay" INTEGER,
    "byWeekday" INTEGER,
    "byMonth" INTEGER,
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "maxOccurrences" INTEGER,
    "nextRunDate" DATE NOT NULL,
    "lastRunAt" TIMESTAMP(3),
    "occurrencesCreated" INTEGER NOT NULL DEFAULT 0,
    "autoPost" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "RecurringRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavingsGoal" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "accountId" TEXT,
    "name" TEXT NOT NULL,
    "targetAmountMinor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "targetDate" DATE,
    "icon" TEXT,
    "color" TEXT,
    "achievedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "SavingsGoal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavingsContribution" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "transactionId" TEXT,
    "amountMinor" BIGINT NOT NULL,
    "date" DATE NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SavingsContribution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Debt" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "accountId" TEXT,
    "direction" "DebtDirection" NOT NULL,
    "counterparty" TEXT NOT NULL,
    "description" TEXT,
    "originalAmountMinor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "interestRateBps" INTEGER,
    "startDate" DATE NOT NULL,
    "dueDate" DATE,
    "installmentsTotal" INTEGER,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Debt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DebtPayment" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "debtId" TEXT NOT NULL,
    "transactionId" TEXT,
    "amountMinor" BIGINT NOT NULL,
    "date" DATE NOT NULL,
    "installmentNo" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DebtPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExchangeRate" (
    "id" TEXT NOT NULL,
    "baseCurrency" CHAR(3) NOT NULL,
    "quoteCurrency" CHAR(3) NOT NULL,
    "date" DATE NOT NULL,
    "rate" DECIMAL(24,12) NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExchangeRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attachment" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "originalName" TEXT NOT NULL,
    "uploadedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Attachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_deletedAt_idx" ON "User"("deletedAt");

-- CreateIndex
CREATE INDEX "Space_deletedAt_idx" ON "Space"("deletedAt");

-- CreateIndex
CREATE INDEX "Membership_spaceId_role_idx" ON "Membership"("spaceId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_userId_spaceId_key" ON "Membership"("userId", "spaceId");

-- CreateIndex
CREATE UNIQUE INDEX "Invitation_tokenHash_key" ON "Invitation"("tokenHash");

-- CreateIndex
CREATE INDEX "Invitation_spaceId_email_idx" ON "Invitation"("spaceId", "email");

-- CreateIndex
CREATE INDEX "Invitation_email_acceptedAt_idx" ON "Invitation"("email", "acceptedAt");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");

-- CreateIndex
CREATE INDEX "RefreshToken_userId_revokedAt_idx" ON "RefreshToken"("userId", "revokedAt");

-- CreateIndex
CREATE INDEX "RefreshToken_expiresAt_idx" ON "RefreshToken"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_tokenHash_key" ON "VerificationToken"("tokenHash");

-- CreateIndex
CREATE INDEX "VerificationToken_userId_type_usedAt_idx" ON "VerificationToken"("userId", "type", "usedAt");

-- CreateIndex
CREATE INDEX "VerificationToken_expiresAt_idx" ON "VerificationToken"("expiresAt");

-- CreateIndex
CREATE INDEX "AuditLog_spaceId_createdAt_idx" ON "AuditLog"("spaceId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_spaceId_entityType_entityId_idx" ON "AuditLog"("spaceId", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "Account_spaceId_isArchived_deletedAt_idx" ON "Account"("spaceId", "isArchived", "deletedAt");

-- CreateIndex
CREATE INDEX "Account_spaceId_sortOrder_idx" ON "Account"("spaceId", "sortOrder");

-- CreateIndex
CREATE INDEX "Category_spaceId_kind_deletedAt_idx" ON "Category"("spaceId", "kind", "deletedAt");

-- CreateIndex
CREATE INDEX "Category_spaceId_parentId_idx" ON "Category"("spaceId", "parentId");

-- CreateIndex
CREATE INDEX "Transaction_spaceId_date_deletedAt_idx" ON "Transaction"("spaceId", "date", "deletedAt");

-- CreateIndex
CREATE INDEX "Transaction_accountId_date_idx" ON "Transaction"("accountId", "date");

-- CreateIndex
CREATE INDEX "Transaction_spaceId_categoryId_date_idx" ON "Transaction"("spaceId", "categoryId", "date");

-- CreateIndex
CREATE INDEX "Transaction_spaceId_createdByUserId_date_idx" ON "Transaction"("spaceId", "createdByUserId", "date");

-- CreateIndex
CREATE INDEX "Transaction_spaceId_transferGroupId_idx" ON "Transaction"("spaceId", "transferGroupId");

-- CreateIndex
CREATE INDEX "Transaction_recurringRuleId_idx" ON "Transaction"("recurringRuleId");

-- CreateIndex
CREATE INDEX "Tag_spaceId_deletedAt_idx" ON "Tag"("spaceId", "deletedAt");

-- CreateIndex
CREATE INDEX "TransactionTag_spaceId_tagId_idx" ON "TransactionTag"("spaceId", "tagId");

-- CreateIndex
CREATE INDEX "Budget_spaceId_isActive_deletedAt_idx" ON "Budget"("spaceId", "isActive", "deletedAt");

-- CreateIndex
CREATE INDEX "Budget_spaceId_categoryId_idx" ON "Budget"("spaceId", "categoryId");

-- CreateIndex
CREATE INDEX "RecurringRule_spaceId_isActive_nextRunDate_idx" ON "RecurringRule"("spaceId", "isActive", "nextRunDate");

-- CreateIndex
CREATE INDEX "RecurringRule_isActive_nextRunDate_idx" ON "RecurringRule"("isActive", "nextRunDate");

-- CreateIndex
CREATE INDEX "SavingsGoal_spaceId_deletedAt_idx" ON "SavingsGoal"("spaceId", "deletedAt");

-- CreateIndex
CREATE INDEX "SavingsContribution_spaceId_goalId_date_idx" ON "SavingsContribution"("spaceId", "goalId", "date");

-- CreateIndex
CREATE INDEX "Debt_spaceId_closedAt_deletedAt_idx" ON "Debt"("spaceId", "closedAt", "deletedAt");

-- CreateIndex
CREATE INDEX "DebtPayment_spaceId_debtId_date_idx" ON "DebtPayment"("spaceId", "debtId", "date");

-- CreateIndex
CREATE INDEX "ExchangeRate_baseCurrency_quoteCurrency_date_idx" ON "ExchangeRate"("baseCurrency", "quoteCurrency", "date");

-- CreateIndex
CREATE UNIQUE INDEX "ExchangeRate_baseCurrency_quoteCurrency_date_source_key" ON "ExchangeRate"("baseCurrency", "quoteCurrency", "date", "source");

-- CreateIndex
CREATE INDEX "Attachment_spaceId_transactionId_idx" ON "Attachment"("spaceId", "transactionId");

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_invitedByUserId_fkey" FOREIGN KEY ("invitedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_invitedByUserId_fkey" FOREIGN KEY ("invitedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_acceptedByUserId_fkey" FOREIGN KEY ("acceptedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationToken" ADD CONSTRAINT "VerificationToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_recurringRuleId_fkey" FOREIGN KEY ("recurringRuleId") REFERENCES "RecurringRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tag" ADD CONSTRAINT "Tag_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransactionTag" ADD CONSTRAINT "TransactionTag_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransactionTag" ADD CONSTRAINT "TransactionTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransactionTag" ADD CONSTRAINT "TransactionTag_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Budget" ADD CONSTRAINT "Budget_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Budget" ADD CONSTRAINT "Budget_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringRule" ADD CONSTRAINT "RecurringRule_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringRule" ADD CONSTRAINT "RecurringRule_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringRule" ADD CONSTRAINT "RecurringRule_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringRule" ADD CONSTRAINT "RecurringRule_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavingsGoal" ADD CONSTRAINT "SavingsGoal_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavingsGoal" ADD CONSTRAINT "SavingsGoal_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavingsContribution" ADD CONSTRAINT "SavingsContribution_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavingsContribution" ADD CONSTRAINT "SavingsContribution_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "SavingsGoal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavingsContribution" ADD CONSTRAINT "SavingsContribution_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Debt" ADD CONSTRAINT "Debt_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Debt" ADD CONSTRAINT "Debt_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DebtPayment" ADD CONSTRAINT "DebtPayment_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DebtPayment" ADD CONSTRAINT "DebtPayment_debtId_fkey" FOREIGN KEY ("debtId") REFERENCES "Debt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DebtPayment" ADD CONSTRAINT "DebtPayment_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ═════════════════════════════════════════════════════════════════════════════
-- Invariantes que Prisma no puede expresar en el schema.
--
-- Van en la base a propósito: son reglas que no quiero que dependan de que
-- todos los caminos del código se acuerden de chequearlas.
-- ═════════════════════════════════════════════════════════════════════════════

-- ── Un Space tiene exactamente un OWNER ──────────────────────────────────────
-- Unique parcial: garantiza "como mucho uno". El "al menos uno" lo sostienen
-- los services (no se puede degradar ni expulsar al único OWNER).
-- La transferencia de propiedad degrada y promueve dentro de una transacción.
CREATE UNIQUE INDEX "Membership_single_owner_per_space"
  ON "Membership" ("spaceId")
  WHERE "role" = 'OWNER';

-- ── Una sola invitación pendiente por (Space, email) ─────────────────────────
-- Sin esto, reinvitar a la misma persona deja varios tokens vivos a la vez.
CREATE UNIQUE INDEX "Invitation_one_pending_per_space_email"
  ON "Invitation" ("spaceId", "email")
  WHERE "acceptedAt" IS NULL AND "revokedAt" IS NULL;

-- ── Nombre de tag único por Space, ignorando los borrados ────────────────────
-- Un unique común impediría volver a crear un tag con el nombre de otro que
-- fue soft-deleted.
CREATE UNIQUE INDEX "Tag_name_unique_per_space"
  ON "Tag" ("spaceId", "name")
  WHERE "deletedAt" IS NULL;

-- ── Dinero ───────────────────────────────────────────────────────────────────
-- El importe es siempre positivo: el signo lo determina `type`. Esto corta de
-- raíz la clase de bug "egreso negativo que suma en vez de restar".
ALTER TABLE "Transaction"
  ADD CONSTRAINT "Transaction_amount_non_negative"
  CHECK ("amountMinor" >= 0);

ALTER TABLE "Transaction"
  ADD CONSTRAINT "Transaction_primary_amount_non_negative"
  CHECK ("amountPrimaryMinor" IS NULL OR "amountPrimaryMinor" >= 0);

-- Si la moneda difiere de la primaria del Space hay que congelar la cotización.
-- Los dos campos van juntos o no va ninguno.
ALTER TABLE "Transaction"
  ADD CONSTRAINT "Transaction_fx_snapshot_complete"
  CHECK (
    ("exchangeRateSnapshot" IS NULL AND "amountPrimaryMinor" IS NULL)
    OR
    ("exchangeRateSnapshot" IS NOT NULL AND "amountPrimaryMinor" IS NOT NULL)
  );

ALTER TABLE "Transaction"
  ADD CONSTRAINT "Transaction_fx_rate_positive"
  CHECK ("exchangeRateSnapshot" IS NULL OR "exchangeRateSnapshot" > 0);

ALTER TABLE "Budget"
  ADD CONSTRAINT "Budget_amount_positive"
  CHECK ("amountMinor" > 0);

ALTER TABLE "RecurringRule"
  ADD CONSTRAINT "RecurringRule_amount_positive"
  CHECK ("amountMinor" > 0);

ALTER TABLE "SavingsGoal"
  ADD CONSTRAINT "SavingsGoal_target_positive"
  CHECK ("targetAmountMinor" > 0);

ALTER TABLE "SavingsContribution"
  ADD CONSTRAINT "SavingsContribution_amount_non_zero"
  CHECK ("amountMinor" <> 0);

ALTER TABLE "Debt"
  ADD CONSTRAINT "Debt_original_amount_positive"
  CHECK ("originalAmountMinor" > 0);

ALTER TABLE "DebtPayment"
  ADD CONSTRAINT "DebtPayment_amount_positive"
  CHECK ("amountMinor" > 0);

ALTER TABLE "ExchangeRate"
  ADD CONSTRAINT "ExchangeRate_rate_positive"
  CHECK ("rate" > 0);

-- ── Monedas: ISO 4217, tres mayúsculas ───────────────────────────────────────
ALTER TABLE "Space"
  ADD CONSTRAINT "Space_currency_iso4217"
  CHECK ("primaryCurrency" SIMILAR TO '[A-Z][A-Z][A-Z]');

ALTER TABLE "Account"
  ADD CONSTRAINT "Account_currency_iso4217"
  CHECK ("currency" SIMILAR TO '[A-Z][A-Z][A-Z]');

ALTER TABLE "Transaction"
  ADD CONSTRAINT "Transaction_currency_iso4217"
  CHECK ("currency" SIMILAR TO '[A-Z][A-Z][A-Z]');

ALTER TABLE "Budget"
  ADD CONSTRAINT "Budget_currency_iso4217"
  CHECK ("currency" SIMILAR TO '[A-Z][A-Z][A-Z]');

ALTER TABLE "RecurringRule"
  ADD CONSTRAINT "RecurringRule_currency_iso4217"
  CHECK ("currency" SIMILAR TO '[A-Z][A-Z][A-Z]');

ALTER TABLE "SavingsGoal"
  ADD CONSTRAINT "SavingsGoal_currency_iso4217"
  CHECK ("currency" SIMILAR TO '[A-Z][A-Z][A-Z]');

ALTER TABLE "Debt"
  ADD CONSTRAINT "Debt_currency_iso4217"
  CHECK ("currency" SIMILAR TO '[A-Z][A-Z][A-Z]');

ALTER TABLE "ExchangeRate"
  ADD CONSTRAINT "ExchangeRate_currencies_iso4217"
  CHECK (
    "baseCurrency"  SIMILAR TO '[A-Z][A-Z][A-Z]'
    AND "quoteCurrency" SIMILAR TO '[A-Z][A-Z][A-Z]'
    AND "baseCurrency" <> "quoteCurrency"
  );

-- ── Tarjetas de crédito ──────────────────────────────────────────────────────
ALTER TABLE "Account"
  ADD CONSTRAINT "Account_credit_days_valid"
  CHECK (
    ("creditClosingDay" IS NULL OR "creditClosingDay" BETWEEN 1 AND 31)
    AND
    ("creditDueDay" IS NULL OR "creditDueDay" BETWEEN 1 AND 31)
  );

-- Solo una tarjeta de crédito puede tener días de cierre y vencimiento.
ALTER TABLE "Account"
  ADD CONSTRAINT "Account_credit_days_only_for_cards"
  CHECK (
    "type" = 'CREDIT_CARD'
    OR ("creditClosingDay" IS NULL AND "creditDueDay" IS NULL)
  );

-- ── Preferencias del usuario ─────────────────────────────────────────────────
ALTER TABLE "User"
  ADD CONSTRAINT "User_week_starts_on_valid"
  CHECK ("weekStartsOn" BETWEEN 0 AND 6);

-- El email se guarda siempre normalizado. Esto lo hace cumplir aunque algún
-- camino de código se olvide de llamar a normalizeEmail().
ALTER TABLE "User"
  ADD CONSTRAINT "User_email_normalized"
  CHECK ("email" = lower(btrim("email")));

ALTER TABLE "Invitation"
  ADD CONSTRAINT "Invitation_email_normalized"
  CHECK ("email" = lower(btrim("email")));

-- ── Reglas de recurrencia ────────────────────────────────────────────────────
ALTER TABLE "RecurringRule"
  ADD CONSTRAINT "RecurringRule_interval_positive"
  CHECK ("interval" >= 1);

ALTER TABLE "RecurringRule"
  ADD CONSTRAINT "RecurringRule_by_fields_valid"
  CHECK (
    ("byMonthDay" IS NULL OR "byMonthDay" BETWEEN 1 AND 31)
    AND ("byWeekday" IS NULL OR "byWeekday" BETWEEN 0 AND 6)
    AND ("byMonth"   IS NULL OR "byMonth"   BETWEEN 1 AND 12)
  );

ALTER TABLE "RecurringRule"
  ADD CONSTRAINT "RecurringRule_end_after_start"
  CHECK ("endDate" IS NULL OR "endDate" >= "startDate");

-- ── Presupuestos ─────────────────────────────────────────────────────────────
-- Un presupuesto CUSTOM sin fecha de fin no tiene período que calcular.
ALTER TABLE "Budget"
  ADD CONSTRAINT "Budget_custom_needs_end_date"
  CHECK ("period" <> 'CUSTOM' OR "endDate" IS NOT NULL);

ALTER TABLE "Budget"
  ADD CONSTRAINT "Budget_end_after_start"
  CHECK ("endDate" IS NULL OR "endDate" >= "startDate");

-- ── Adjuntos ─────────────────────────────────────────────────────────────────
ALTER TABLE "Attachment"
  ADD CONSTRAINT "Attachment_size_positive"
  CHECK ("sizeBytes" > 0);

-- ── Deudas ───────────────────────────────────────────────────────────────────
ALTER TABLE "Debt"
  ADD CONSTRAINT "Debt_installments_positive"
  CHECK ("installmentsTotal" IS NULL OR "installmentsTotal" > 0);

ALTER TABLE "Debt"
  ADD CONSTRAINT "Debt_interest_non_negative"
  CHECK ("interestRateBps" IS NULL OR "interestRateBps" >= 0);

