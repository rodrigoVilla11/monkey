-- DropForeignKey
ALTER TABLE "Attachment" DROP CONSTRAINT "Attachment_transactionId_fkey";

-- DropForeignKey
ALTER TABLE "Budget" DROP CONSTRAINT "Budget_categoryId_fkey";

-- DropForeignKey
ALTER TABLE "Category" DROP CONSTRAINT "Category_parentId_fkey";

-- DropForeignKey
ALTER TABLE "Debt" DROP CONSTRAINT "Debt_accountId_fkey";

-- DropForeignKey
ALTER TABLE "DebtPayment" DROP CONSTRAINT "DebtPayment_debtId_fkey";

-- DropForeignKey
ALTER TABLE "DebtPayment" DROP CONSTRAINT "DebtPayment_transactionId_fkey";

-- DropForeignKey
ALTER TABLE "RecurringRule" DROP CONSTRAINT "RecurringRule_accountId_fkey";

-- DropForeignKey
ALTER TABLE "RecurringRule" DROP CONSTRAINT "RecurringRule_categoryId_fkey";

-- DropForeignKey
ALTER TABLE "SavingsContribution" DROP CONSTRAINT "SavingsContribution_goalId_fkey";

-- DropForeignKey
ALTER TABLE "SavingsContribution" DROP CONSTRAINT "SavingsContribution_transactionId_fkey";

-- DropForeignKey
ALTER TABLE "SavingsGoal" DROP CONSTRAINT "SavingsGoal_accountId_fkey";

-- DropForeignKey
ALTER TABLE "Transaction" DROP CONSTRAINT "Transaction_accountId_fkey";

-- DropForeignKey
ALTER TABLE "Transaction" DROP CONSTRAINT "Transaction_categoryId_fkey";

-- DropForeignKey
ALTER TABLE "Transaction" DROP CONSTRAINT "Transaction_recurringRuleId_fkey";

-- DropForeignKey
ALTER TABLE "TransactionTag" DROP CONSTRAINT "TransactionTag_tagId_fkey";

-- DropForeignKey
ALTER TABLE "TransactionTag" DROP CONSTRAINT "TransactionTag_transactionId_fkey";

-- CreateIndex
CREATE UNIQUE INDEX "Account_spaceId_id_key" ON "Account"("spaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Category_spaceId_id_key" ON "Category"("spaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Debt_spaceId_id_key" ON "Debt"("spaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "RecurringRule_spaceId_id_key" ON "RecurringRule"("spaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "SavingsGoal_spaceId_id_key" ON "SavingsGoal"("spaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Tag_spaceId_id_key" ON "Tag"("spaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_spaceId_id_key" ON "Transaction"("spaceId", "id");

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_spaceId_parentId_fkey" FOREIGN KEY ("spaceId", "parentId") REFERENCES "Category"("spaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_spaceId_accountId_fkey" FOREIGN KEY ("spaceId", "accountId") REFERENCES "Account"("spaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_spaceId_categoryId_fkey" FOREIGN KEY ("spaceId", "categoryId") REFERENCES "Category"("spaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_spaceId_recurringRuleId_fkey" FOREIGN KEY ("spaceId", "recurringRuleId") REFERENCES "RecurringRule"("spaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransactionTag" ADD CONSTRAINT "TransactionTag_spaceId_transactionId_fkey" FOREIGN KEY ("spaceId", "transactionId") REFERENCES "Transaction"("spaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransactionTag" ADD CONSTRAINT "TransactionTag_spaceId_tagId_fkey" FOREIGN KEY ("spaceId", "tagId") REFERENCES "Tag"("spaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Budget" ADD CONSTRAINT "Budget_spaceId_categoryId_fkey" FOREIGN KEY ("spaceId", "categoryId") REFERENCES "Category"("spaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringRule" ADD CONSTRAINT "RecurringRule_spaceId_accountId_fkey" FOREIGN KEY ("spaceId", "accountId") REFERENCES "Account"("spaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringRule" ADD CONSTRAINT "RecurringRule_spaceId_categoryId_fkey" FOREIGN KEY ("spaceId", "categoryId") REFERENCES "Category"("spaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavingsGoal" ADD CONSTRAINT "SavingsGoal_spaceId_accountId_fkey" FOREIGN KEY ("spaceId", "accountId") REFERENCES "Account"("spaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavingsContribution" ADD CONSTRAINT "SavingsContribution_spaceId_goalId_fkey" FOREIGN KEY ("spaceId", "goalId") REFERENCES "SavingsGoal"("spaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavingsContribution" ADD CONSTRAINT "SavingsContribution_spaceId_transactionId_fkey" FOREIGN KEY ("spaceId", "transactionId") REFERENCES "Transaction"("spaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Debt" ADD CONSTRAINT "Debt_spaceId_accountId_fkey" FOREIGN KEY ("spaceId", "accountId") REFERENCES "Account"("spaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DebtPayment" ADD CONSTRAINT "DebtPayment_spaceId_debtId_fkey" FOREIGN KEY ("spaceId", "debtId") REFERENCES "Debt"("spaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DebtPayment" ADD CONSTRAINT "DebtPayment_spaceId_transactionId_fkey" FOREIGN KEY ("spaceId", "transactionId") REFERENCES "Transaction"("spaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_spaceId_transactionId_fkey" FOREIGN KEY ("spaceId", "transactionId") REFERENCES "Transaction"("spaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
