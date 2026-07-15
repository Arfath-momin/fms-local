-- CreateEnum
CREATE TYPE "Role" AS ENUM ('MERCHANT', 'AUDITOR');

-- CreateEnum
CREATE TYPE "PartyType" AS ENUM ('SOCIETY', 'PRIVATE_SELLER', 'BOAT', 'MARKET_BUYER', 'FACTORY', 'FISH_MILL', 'LOCAL_BUYER');

-- CreateEnum
CREATE TYPE "PurchaseType" AS ENUM ('SOCIETY', 'PRIVATE', 'LOCAL');

-- CreateEnum
CREATE TYPE "StockState" AS ENUM ('AVAILABLE', 'IN_TRANSIT', 'SOLD', 'LOSS');

-- CreateEnum
CREATE TYPE "StockDirection" AS ENUM ('IN', 'OUT');

-- CreateEnum
CREATE TYPE "StockSourceType" AS ENUM ('PURCHASE', 'DELIVERY', 'SETTLEMENT', 'SETTLEMENT_RETURN', 'LOSS_WRITEOFF', 'DIRECT_SALE');

-- CreateEnum
CREATE TYPE "DeliveryChannel" AS ENUM ('FACTORY', 'MARKET', 'FISH_MILL', 'LOCAL_SALE');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('PENDING', 'PARTIALLY_SETTLED', 'SETTLED');

-- CreateEnum
CREATE TYPE "ExpenseCategory" AS ENUM ('LOADERS', 'WORKERS', 'ICE', 'CANTEEN', 'RENT', 'TRANSPORT', 'FUEL', 'MISC');

-- CreateEnum
CREATE TYPE "LedgerEntryType" AS ENUM ('DEBIT', 'CREDIT');

-- CreateEnum
CREATE TYPE "LedgerSourceType" AS ENUM ('PURCHASE', 'SALE', 'SETTLEMENT', 'PRICE_VARIANCE', 'PAYMENT');

-- CreateEnum
CREATE TYPE "AttachmentLinkedType" AS ENUM ('PURCHASE', 'DELIVERY_NOTE', 'SETTLEMENT', 'EXPENSE');

-- CreateEnum
CREATE TYPE "ErrorFlagLinkedType" AS ENUM ('PURCHASE', 'DELIVERY_NOTE', 'SETTLEMENT', 'DIRECT_SALE', 'EXPENSE');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "companies" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "local_invoice_seq" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parties" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "PartyType" NOT NULL,
    "contact_info" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "parties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchases" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "party_id" TEXT NOT NULL,
    "type" "PurchaseType" NOT NULL,
    "invoice_number" TEXT NOT NULL,
    "fish_type" TEXT NOT NULL,
    "qty_kg" DECIMAL(12,3) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "date" DATE NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "fish_type" TEXT NOT NULL,
    "qty_kg" DECIMAL(12,3) NOT NULL,
    "direction" "StockDirection" NOT NULL,
    "state" "StockState" NOT NULL,
    "source_type" "StockSourceType" NOT NULL,
    "source_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_notes" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "party_id" TEXT NOT NULL,
    "channel" "DeliveryChannel" NOT NULL,
    "fish_type" TEXT NOT NULL,
    "qty_sent" DECIMAL(12,3) NOT NULL,
    "rate" DECIMAL(12,2) NOT NULL,
    "expected_value" DECIMAL(14,2) NOT NULL,
    "date" DATE NOT NULL,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "delivery_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settlements" (
    "id" TEXT NOT NULL,
    "delivery_note_id" TEXT NOT NULL,
    "qty_accepted" DECIMAL(12,3) NOT NULL,
    "qty_returned" DECIMAL(12,3) NOT NULL,
    "qty_spoiled" DECIMAL(12,3) NOT NULL,
    "amount_received" DECIMAL(14,2) NOT NULL,
    "date" DATE NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "gross" DECIMAL(14,2),
    "commission" DECIMAL(14,2),
    "owner_reserve" DECIMAL(14,2),

    CONSTRAINT "settlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "direct_sales" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "party_id" TEXT NOT NULL,
    "fish_type" TEXT NOT NULL,
    "qty_kg" DECIMAL(12,3) NOT NULL,
    "rate" DECIMAL(12,2) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "date" DATE NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "direct_sales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "owner_reserve_entries" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "settlement_id" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "date" DATE NOT NULL,
    "running_balance" DECIMAL(14,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "owner_reserve_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expenses" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "category" "ExpenseCategory" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "date" DATE NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "party_id" TEXT NOT NULL,
    "type" "LedgerEntryType" NOT NULL,
    "source_type" "LedgerSourceType" NOT NULL,
    "source_id" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "date" DATE NOT NULL,
    "running_balance" DECIMAL(14,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attachments" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "linked_type" "AttachmentLinkedType" NOT NULL,
    "linked_id" TEXT NOT NULL,
    "image_url" TEXT NOT NULL,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "day_closes" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "closed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "day_closes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "error_flags" (
    "id" TEXT NOT NULL,
    "linked_type" "ErrorFlagLinkedType" NOT NULL,
    "linked_id" TEXT NOT NULL,
    "flagged_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT,
    "correcting_entry_id" TEXT,

    CONSTRAINT "error_flags_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "companies_name_key" ON "companies"("name");

-- CreateIndex
CREATE INDEX "purchases_company_id_date_idx" ON "purchases"("company_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "purchases_company_id_invoice_number_key" ON "purchases"("company_id", "invoice_number");

-- CreateIndex
CREATE INDEX "stock_movements_company_id_fish_type_state_idx" ON "stock_movements"("company_id", "fish_type", "state");

-- CreateIndex
CREATE INDEX "stock_movements_source_type_source_id_idx" ON "stock_movements"("source_type", "source_id");

-- CreateIndex
CREATE INDEX "delivery_notes_company_id_status_idx" ON "delivery_notes"("company_id", "status");

-- CreateIndex
CREATE INDEX "delivery_notes_company_id_date_idx" ON "delivery_notes"("company_id", "date");

-- CreateIndex
CREATE INDEX "settlements_delivery_note_id_idx" ON "settlements"("delivery_note_id");

-- CreateIndex
CREATE INDEX "direct_sales_company_id_date_idx" ON "direct_sales"("company_id", "date");

-- CreateIndex
CREATE INDEX "owner_reserve_entries_company_id_date_idx" ON "owner_reserve_entries"("company_id", "date");

-- CreateIndex
CREATE INDEX "expenses_company_id_category_date_idx" ON "expenses"("company_id", "category", "date");

-- CreateIndex
CREATE INDEX "ledger_entries_company_id_party_id_date_idx" ON "ledger_entries"("company_id", "party_id", "date");

-- CreateIndex
CREATE INDEX "ledger_entries_source_type_source_id_idx" ON "ledger_entries"("source_type", "source_id");

-- CreateIndex
CREATE INDEX "attachments_linked_type_linked_id_idx" ON "attachments"("linked_type", "linked_id");

-- CreateIndex
CREATE UNIQUE INDEX "day_closes_company_id_date_key" ON "day_closes"("company_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "error_flags_linked_type_linked_id_key" ON "error_flags"("linked_type", "linked_id");

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "parties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_notes" ADD CONSTRAINT "delivery_notes_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_notes" ADD CONSTRAINT "delivery_notes_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "parties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_delivery_note_id_fkey" FOREIGN KEY ("delivery_note_id") REFERENCES "delivery_notes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "direct_sales" ADD CONSTRAINT "direct_sales_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "direct_sales" ADD CONSTRAINT "direct_sales_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "parties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "owner_reserve_entries" ADD CONSTRAINT "owner_reserve_entries_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "owner_reserve_entries" ADD CONSTRAINT "owner_reserve_entries_settlement_id_fkey" FOREIGN KEY ("settlement_id") REFERENCES "settlements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "parties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "day_closes" ADD CONSTRAINT "day_closes_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
