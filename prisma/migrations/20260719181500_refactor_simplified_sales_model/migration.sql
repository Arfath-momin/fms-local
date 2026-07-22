-- AlterEnum
BEGIN;
CREATE TYPE "DeliveryChannel_new" AS ENUM ('MARKET', 'FACTORY', 'FISH_MILL', 'LOCAL');
ALTER TABLE "delivery_notes" ALTER COLUMN "channel" TYPE "DeliveryChannel_new" USING ("channel"::text::"DeliveryChannel_new");
ALTER TYPE "DeliveryChannel" RENAME TO "DeliveryChannel_old";
ALTER TYPE "DeliveryChannel_new" RENAME TO "DeliveryChannel";
DROP TYPE "public"."DeliveryChannel_old";
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "DeliveryStatus_new" AS ENUM ('PENDING', 'SETTLED');
ALTER TABLE "public"."delivery_notes" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "delivery_notes" ALTER COLUMN "status" TYPE "DeliveryStatus_new" USING ("status"::text::"DeliveryStatus_new");
ALTER TYPE "DeliveryStatus" RENAME TO "DeliveryStatus_old";
ALTER TYPE "DeliveryStatus_new" RENAME TO "DeliveryStatus";
DROP TYPE "public"."DeliveryStatus_old";
ALTER TABLE "delivery_notes" ALTER COLUMN "status" SET DEFAULT 'PENDING';
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "ErrorFlagLinkedType_new" AS ENUM ('PURCHASE', 'DELIVERY_NOTE', 'SETTLEMENT', 'EXPENSE');
ALTER TABLE "error_flags" ALTER COLUMN "linked_type" TYPE "ErrorFlagLinkedType_new" USING ("linked_type"::text::"ErrorFlagLinkedType_new");
ALTER TYPE "ErrorFlagLinkedType" RENAME TO "ErrorFlagLinkedType_old";
ALTER TYPE "ErrorFlagLinkedType_new" RENAME TO "ErrorFlagLinkedType";
DROP TYPE "public"."ErrorFlagLinkedType_old";
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "ExpenseCategory_new" AS ENUM ('ICE', 'LOADERS', 'LADIES', 'BATHA', 'CANTEEN', 'RENT');
ALTER TABLE "expenses" ALTER COLUMN "category" TYPE "ExpenseCategory_new" USING ("category"::text::"ExpenseCategory_new");
ALTER TYPE "ExpenseCategory" RENAME TO "ExpenseCategory_old";
ALTER TYPE "ExpenseCategory_new" RENAME TO "ExpenseCategory";
DROP TYPE "public"."ExpenseCategory_old";
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "LedgerSourceType_new" AS ENUM ('PURCHASE', 'SALE', 'EXPENSE', 'PAYMENT');
ALTER TABLE "ledger_entries" ALTER COLUMN "source_type" TYPE "LedgerSourceType_new" USING ("source_type"::text::"LedgerSourceType_new");
ALTER TYPE "LedgerSourceType" RENAME TO "LedgerSourceType_old";
ALTER TYPE "LedgerSourceType_new" RENAME TO "LedgerSourceType";
DROP TYPE "public"."LedgerSourceType_old";
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "PartyType_new" AS ENUM ('BOAT', 'LOCAL_SELLER', 'MARKET_BUYER', 'FACTORY', 'FISH_MILL', 'LOCAL_BUYER', 'EXPENSE_VENDOR');
ALTER TABLE "parties" ALTER COLUMN "type" TYPE "PartyType_new" USING ("type"::text::"PartyType_new");
ALTER TYPE "PartyType" RENAME TO "PartyType_old";
ALTER TYPE "PartyType_new" RENAME TO "PartyType";
DROP TYPE "public"."PartyType_old";
COMMIT;

-- AlterEnum
ALTER TYPE "PurchaseType" ADD VALUE 'KFDC';

-- DropForeignKey
ALTER TABLE "direct_sales" DROP CONSTRAINT "direct_sales_company_id_fkey";

-- DropForeignKey
ALTER TABLE "direct_sales" DROP CONSTRAINT "direct_sales_party_id_fkey";

-- DropForeignKey
ALTER TABLE "owner_reserve_entries" DROP CONSTRAINT "owner_reserve_entries_company_id_fkey";

-- DropForeignKey
ALTER TABLE "owner_reserve_entries" DROP CONSTRAINT "owner_reserve_entries_settlement_id_fkey";

-- DropForeignKey
ALTER TABLE "stock_movements" DROP CONSTRAINT "stock_movements_company_id_fkey";

-- DropIndex
DROP INDEX "purchases_company_id_invoice_number_key";

-- AlterTable
ALTER TABLE "companies" DROP COLUMN "local_invoice_seq";

-- AlterTable
ALTER TABLE "delivery_notes" DROP COLUMN "expected_value",
DROP COLUMN "fish_type",
DROP COLUMN "qty_sent",
DROP COLUMN "rate",
ADD COLUMN     "vehicle_no" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "expenses" ADD COLUMN     "details" JSONB,
ADD COLUMN     "paid" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "party_id" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "purchases" DROP COLUMN "fish_type",
DROP COLUMN "invoice_number",
DROP COLUMN "qty_kg",
ADD COLUMN     "paid" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "settlements" DROP COLUMN "commission",
DROP COLUMN "gross",
DROP COLUMN "owner_reserve",
DROP COLUMN "qty_accepted",
DROP COLUMN "qty_returned",
DROP COLUMN "qty_spoiled";

-- DropTable
DROP TABLE "direct_sales";

-- DropTable
DROP TABLE "owner_reserve_entries";

-- DropTable
DROP TABLE "stock_movements";

-- DropEnum
DROP TYPE "StockDirection";

-- DropEnum
DROP TYPE "StockSourceType";

-- DropEnum
DROP TYPE "StockState";

-- CreateTable
CREATE TABLE "purchase_lines" (
    "id" TEXT NOT NULL,
    "purchase_id" TEXT NOT NULL,
    "particular" TEXT NOT NULL,
    "qty_kg" DECIMAL(12,3) NOT NULL,
    "price_per_kg" DECIMAL(12,2) NOT NULL,
    "total" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "purchase_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "purchase_lines_purchase_id_idx" ON "purchase_lines"("purchase_id");

-- CreateIndex
CREATE UNIQUE INDEX "parties_name_type_key" ON "parties"("name", "type");

-- AddForeignKey
ALTER TABLE "purchase_lines" ADD CONSTRAINT "purchase_lines_purchase_id_fkey" FOREIGN KEY ("purchase_id") REFERENCES "purchases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "parties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
