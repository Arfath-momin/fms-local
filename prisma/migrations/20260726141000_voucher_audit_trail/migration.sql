-- Who entered a voucher and who last changed it. Nullable because rows that
-- predate this migration have no known author. ON DELETE SET NULL rather than
-- cascade: losing a user must never delete their vouchers (accounts are
-- deactivated rather than deleted anyway).

-- AlterTable
ALTER TABLE "delivery_notes" ADD COLUMN     "created_by_id" TEXT,
ADD COLUMN     "updated_at" TIMESTAMP(3),
ADD COLUMN     "updated_by_id" TEXT;

-- AlterTable
ALTER TABLE "expenses" ADD COLUMN     "created_by_id" TEXT,
ADD COLUMN     "updated_at" TIMESTAMP(3),
ADD COLUMN     "updated_by_id" TEXT;

-- AlterTable
ALTER TABLE "purchases" ADD COLUMN     "created_by_id" TEXT,
ADD COLUMN     "updated_at" TIMESTAMP(3),
ADD COLUMN     "updated_by_id" TEXT;

-- AlterTable
ALTER TABLE "sales" ADD COLUMN     "created_by_id" TEXT,
ADD COLUMN     "updated_at" TIMESTAMP(3),
ADD COLUMN     "updated_by_id" TEXT;

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_notes" ADD CONSTRAINT "delivery_notes_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_notes" ADD CONSTRAINT "delivery_notes_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
