-- V2: Company > Centre hierarchy, sale-per-type rewrite, delivery note as a
-- record in its own right (settlements dropped). This migration was missing:
-- the schema was changed and pushed directly, so the change never entered the
-- migration history. Reconstructed with `prisma migrate diff`.

-- CreateEnum
CREATE TYPE "SaleType" AS ENUM ('MARKET', 'FISH_MILL', 'FACTORY', 'LOCAL');

-- AlterEnum
BEGIN;
CREATE TYPE "AttachmentLinkedType_new" AS ENUM ('PURCHASE', 'DELIVERY_NOTE', 'SALE', 'EXPENSE');
ALTER TABLE "attachments" ALTER COLUMN "linked_type" TYPE "AttachmentLinkedType_new" USING ("linked_type"::text::"AttachmentLinkedType_new");
ALTER TYPE "AttachmentLinkedType" RENAME TO "AttachmentLinkedType_old";
ALTER TYPE "AttachmentLinkedType_new" RENAME TO "AttachmentLinkedType";
DROP TYPE "public"."AttachmentLinkedType_old";
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "ErrorFlagLinkedType_new" AS ENUM ('PURCHASE', 'DELIVERY_NOTE', 'SALE', 'EXPENSE');
ALTER TABLE "error_flags" ALTER COLUMN "linked_type" TYPE "ErrorFlagLinkedType_new" USING ("linked_type"::text::"ErrorFlagLinkedType_new");
ALTER TYPE "ErrorFlagLinkedType" RENAME TO "ErrorFlagLinkedType_old";
ALTER TYPE "ErrorFlagLinkedType_new" RENAME TO "ErrorFlagLinkedType";
DROP TYPE "public"."ErrorFlagLinkedType_old";
COMMIT;

-- AlterEnum
ALTER TYPE "PartyType" ADD VALUE 'CARE_OF';

-- DropForeignKey
ALTER TABLE "delivery_notes" DROP CONSTRAINT "delivery_notes_party_id_fkey";

-- DropForeignKey
ALTER TABLE "settlements" DROP CONSTRAINT "settlements_delivery_note_id_fkey";

-- DropIndex
DROP INDEX "day_closes_company_id_date_key";

-- DropIndex
DROP INDEX "delivery_notes_company_id_date_idx";

-- DropIndex
DROP INDEX "delivery_notes_company_id_status_idx";

-- DropIndex
DROP INDEX "expenses_company_id_category_date_idx";

-- DropIndex
DROP INDEX "ledger_entries_company_id_party_id_date_idx";

-- DropIndex
DROP INDEX "purchases_company_id_date_idx";

-- AlterTable
ALTER TABLE "attachments" ADD COLUMN     "centre_id" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "day_closes" ADD COLUMN     "centre_id" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "delivery_notes" DROP COLUMN "channel",
DROP COLUMN "party_id",
DROP COLUMN "status",
ADD COLUMN     "advance_paid" DECIMAL(14,2),
ADD COLUMN     "bill_no" TEXT NOT NULL,
ADD COLUMN     "centre_id" TEXT NOT NULL,
ADD COLUMN     "driver_name" TEXT,
ADD COLUMN     "mobile_no" TEXT,
ADD COLUMN     "recipient" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "expenses" ADD COLUMN     "centre_id" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "ledger_entries" ADD COLUMN     "centre_id" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "purchases" ADD COLUMN     "centre_id" TEXT NOT NULL;

-- DropTable
DROP TABLE "settlements";

-- DropEnum
DROP TYPE "DeliveryChannel";

-- DropEnum
DROP TYPE "DeliveryStatus";

-- CreateTable
CREATE TABLE "centres" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "centres_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_note_lines" (
    "id" TEXT NOT NULL,
    "delivery_note_id" TEXT NOT NULL,
    "particulars" TEXT NOT NULL,
    "kg" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "box" INTEGER NOT NULL DEFAULT 0,
    "big_box" INTEGER NOT NULL DEFAULT 0,
    "loose" INTEGER NOT NULL DEFAULT 0,
    "pcs" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "delivery_note_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "centre_id" TEXT NOT NULL,
    "type" "SaleType" NOT NULL,
    "party_id" TEXT NOT NULL,
    "care_of_party_id" TEXT,
    "bill_no" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "amount_received" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total_bill" DECIMAL(14,2),
    "commission" DECIMAL(14,2),
    "place" TEXT,
    "weight" DECIMAL(12,3),
    "net_weight" DECIMAL(12,3),
    "vehicle_no" TEXT,
    "place_of_loading" TEXT,
    "return_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_lines" (
    "id" TEXT NOT NULL,
    "sale_id" TEXT NOT NULL,
    "particular" TEXT NOT NULL,
    "box" INTEGER,
    "qty_kg" DECIMAL(12,3) NOT NULL,
    "rate_per_kg" DECIMAL(12,2) NOT NULL,
    "count" INTEGER,
    "total" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "sale_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "centres_company_id_name_key" ON "centres"("company_id", "name");

-- CreateIndex
CREATE INDEX "delivery_note_lines_delivery_note_id_idx" ON "delivery_note_lines"("delivery_note_id");

-- CreateIndex
CREATE INDEX "sales_company_id_centre_id_date_idx" ON "sales"("company_id", "centre_id", "date");

-- CreateIndex
CREATE INDEX "sales_company_id_centre_id_type_idx" ON "sales"("company_id", "centre_id", "type");

-- CreateIndex
CREATE INDEX "sale_lines_sale_id_idx" ON "sale_lines"("sale_id");

-- CreateIndex
CREATE UNIQUE INDEX "day_closes_company_id_centre_id_date_key" ON "day_closes"("company_id", "centre_id", "date");

-- CreateIndex
CREATE INDEX "delivery_notes_company_id_centre_id_date_idx" ON "delivery_notes"("company_id", "centre_id", "date");

-- CreateIndex
CREATE INDEX "expenses_company_id_centre_id_category_date_idx" ON "expenses"("company_id", "centre_id", "category", "date");

-- CreateIndex
CREATE INDEX "ledger_entries_company_id_centre_id_party_id_date_idx" ON "ledger_entries"("company_id", "centre_id", "party_id", "date");

-- CreateIndex
CREATE INDEX "purchases_company_id_centre_id_date_idx" ON "purchases"("company_id", "centre_id", "date");

-- AddForeignKey
ALTER TABLE "centres" ADD CONSTRAINT "centres_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_centre_id_fkey" FOREIGN KEY ("centre_id") REFERENCES "centres"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_centre_id_fkey" FOREIGN KEY ("centre_id") REFERENCES "centres"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_notes" ADD CONSTRAINT "delivery_notes_centre_id_fkey" FOREIGN KEY ("centre_id") REFERENCES "centres"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_note_lines" ADD CONSTRAINT "delivery_note_lines_delivery_note_id_fkey" FOREIGN KEY ("delivery_note_id") REFERENCES "delivery_notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_centre_id_fkey" FOREIGN KEY ("centre_id") REFERENCES "centres"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "parties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_care_of_party_id_fkey" FOREIGN KEY ("care_of_party_id") REFERENCES "parties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_centre_id_fkey" FOREIGN KEY ("centre_id") REFERENCES "centres"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_centre_id_fkey" FOREIGN KEY ("centre_id") REFERENCES "centres"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "day_closes" ADD CONSTRAINT "day_closes_centre_id_fkey" FOREIGN KEY ("centre_id") REFERENCES "centres"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
