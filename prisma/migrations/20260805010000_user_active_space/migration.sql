-- AlterTable
ALTER TABLE "User" ADD COLUMN     "activeSpaceId" TEXT;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_activeSpaceId_fkey" FOREIGN KEY ("activeSpaceId") REFERENCES "Space"("id") ON DELETE SET NULL ON UPDATE CASCADE;
