-- CreateEnum
CREATE TYPE "Role" AS ENUM ('SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT', 'AUDITOR');

-- CreateEnum
CREATE TYPE "PartyType" AS ENUM ('BOAT', 'MARKET_BUYER', 'FACTORY', 'FISH_MILL', 'LOCAL_BUYER', 'EXPENSE_VENDOR', 'CARE_OF', 'PURCHASE_GROUP', 'TRANSPORTER');

-- CreateEnum
CREATE TYPE "PurchaseType" AS ENUM ('SOCIETY', 'KFDC', 'PRIVATE', 'LOCAL');

-- CreateEnum
CREATE TYPE "ExpenseKind" AS ENUM ('DIRECT', 'OVERHEAD');

-- CreateEnum
CREATE TYPE "TripChannel" AS ENUM ('MARKET', 'FACTORY', 'FISH_MILL', 'LOCAL');

-- CreateEnum
CREATE TYPE "TripStatus" AS ENUM ('DISPATCHED', 'PART_BILLED', 'CLOSED');

-- CreateEnum
CREATE TYPE "SaleType" AS ENUM ('MARKET', 'FISH_MILL', 'FACTORY', 'LOCAL');

-- CreateEnum
CREATE TYPE "SettlementKind" AS ENUM ('PAYMENT', 'RECEIPT');

-- CreateEnum
CREATE TYPE "SettlementMode" AS ENUM ('CASH', 'BANK', 'UPI', 'CHEQUE');

-- CreateEnum
CREATE TYPE "LedgerEntryType" AS ENUM ('DEBIT', 'CREDIT');

-- CreateEnum
CREATE TYPE "LedgerSourceType" AS ENUM ('PURCHASE', 'SALE', 'EXPENSE', 'PAYMENT', 'RECEIPT', 'RENT', 'RENT_BY_PARTY', 'COMMISSION', 'RESERVE');

-- CreateEnum
CREATE TYPE "AttachmentLinkedType" AS ENUM ('PURCHASE', 'DELIVERY_NOTE', 'SALE', 'EXPENSE');

-- CreateEnum
CREATE TYPE "ReviewLinkedType" AS ENUM ('PURCHASE', 'SALE', 'EXPENSE', 'DELIVERY_NOTE', 'PAYMENT', 'RECEIPT');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('OPEN', 'RESOLVED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_companies" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "companies" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "colour" VARCHAR(7),
    "legal_name" TEXT,
    "address" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "contact_person" TEXT,
    "gstin" TEXT,
    "logo_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "centres" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archived_at" TIMESTAMP(3),

    CONSTRAINT "centres_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parties" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "PartyType" NOT NULL,
    "contact_info" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archived_at" TIMESTAMP(3),
    "purchase_kind" "PurchaseType",

    CONSTRAINT "parties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicles" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "transporter_id" TEXT NOT NULL,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchases" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "centre_id" TEXT NOT NULL,
    "party_id" TEXT NOT NULL,
    "bill_no" TEXT,
    "type" "PurchaseType" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "date" DATE NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3),
    "created_by_id" TEXT,
    "updated_by_id" TEXT,

    CONSTRAINT "purchases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_lines" (
    "id" TEXT NOT NULL,
    "purchase_id" TEXT NOT NULL,
    "boat_id" TEXT,
    "particular" TEXT NOT NULL,
    "qty_kg" DECIMAL(12,3) NOT NULL,
    "price_per_kg" DECIMAL(12,2) NOT NULL,
    "total" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "purchase_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense_categories" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "ExpenseKind" NOT NULL,
    "allows_lines" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "expense_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense_lines" (
    "id" TEXT NOT NULL,
    "expense_id" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "expense_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expenses" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "centre_id" TEXT NOT NULL,
    "party_id" TEXT,
    "category_id" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "details" JSONB,
    "notes" TEXT,
    "date" DATE NOT NULL,
    "spent_on" DATE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3),
    "created_by_id" TEXT,
    "updated_by_id" TEXT,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_notes" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "centre_id" TEXT NOT NULL,
    "bill_no" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "dispatched_on" DATE,
    "channel" "TripChannel" NOT NULL,
    "vehicle_id" TEXT NOT NULL,
    "rent_amount" DECIMAL(14,2),
    "advance_paid" DECIMAL(14,2),
    "status" "TripStatus" NOT NULL DEFAULT 'DISPATCHED',
    "crates_returned" INTEGER,
    "recipient" TEXT,
    "driver_name" TEXT,
    "mobile_no" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3),
    "created_by_id" TEXT,
    "updated_by_id" TEXT,

    CONSTRAINT "delivery_notes_pkey" PRIMARY KEY ("id")
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
    "sale_date" DATE,
    "amount" DECIMAL(14,2) NOT NULL,
    "delivery_note_id" TEXT,
    "total_bill" DECIMAL(14,2),
    "commission" DECIMAL(14,2),
    "commission_rate" DECIMAL(5,2),
    "reserve" DECIMAL(14,2),
    "other_deduction" DECIMAL(14,2),
    "carries_rent" BOOLEAN NOT NULL DEFAULT false,
    "rent_deducted" DECIMAL(14,2),
    "place" TEXT,
    "weight" DECIMAL(12,3),
    "net_weight" DECIMAL(12,3),
    "vehicle_no" TEXT,
    "place_of_loading" TEXT,
    "return_note" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3),
    "created_by_id" TEXT,
    "updated_by_id" TEXT,

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

-- CreateTable
CREATE TABLE "settlements" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "centre_id" TEXT NOT NULL,
    "party_id" TEXT NOT NULL,
    "kind" "SettlementKind" NOT NULL,
    "mode" "SettlementMode" NOT NULL DEFAULT 'CASH',
    "amount" DECIMAL(14,2) NOT NULL,
    "date" DATE NOT NULL,
    "reference" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3),
    "created_by_id" TEXT,
    "updated_by_id" TEXT,

    CONSTRAINT "settlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reserve_collections" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "centre_id" TEXT NOT NULL,
    "party_id" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "date" DATE NOT NULL,
    "mode" "SettlementMode" NOT NULL DEFAULT 'CASH',
    "reference" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" TEXT,

    CONSTRAINT "reserve_collections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" TEXT NOT NULL,
    "seq" SERIAL NOT NULL,
    "company_id" TEXT NOT NULL,
    "centre_id" TEXT NOT NULL,
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
    "centre_id" TEXT NOT NULL,
    "linked_type" "AttachmentLinkedType" NOT NULL,
    "linked_id" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_requests" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "centre_id" TEXT NOT NULL,
    "linked_type" "ReviewLinkedType" NOT NULL,
    "linked_id" TEXT NOT NULL,
    "status" "ReviewStatus" NOT NULL DEFAULT 'OPEN',
    "reason" TEXT NOT NULL,
    "requested_by_id" TEXT,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_by_id" TEXT,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "review_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "user_companies_user_id_idx" ON "user_companies"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_companies_user_id_company_id_key" ON "user_companies"("user_id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "companies_name_key" ON "companies"("name");

-- CreateIndex
CREATE UNIQUE INDEX "centres_company_id_name_key" ON "centres"("company_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "parties_name_type_key" ON "parties"("name", "type");

-- CreateIndex
CREATE INDEX "vehicles_transporter_id_idx" ON "vehicles"("transporter_id");

-- CreateIndex
CREATE UNIQUE INDEX "vehicles_company_id_number_key" ON "vehicles"("company_id", "number");

-- CreateIndex
CREATE INDEX "purchases_company_id_centre_id_date_idx" ON "purchases"("company_id", "centre_id", "date");

-- CreateIndex
CREATE INDEX "purchase_lines_purchase_id_idx" ON "purchase_lines"("purchase_id");

-- CreateIndex
CREATE INDEX "purchase_lines_boat_id_idx" ON "purchase_lines"("boat_id");

-- CreateIndex
CREATE UNIQUE INDEX "expense_categories_company_id_code_key" ON "expense_categories"("company_id", "code");

-- CreateIndex
CREATE INDEX "expense_lines_expense_id_idx" ON "expense_lines"("expense_id");

-- CreateIndex
CREATE INDEX "expenses_company_id_centre_id_category_id_date_idx" ON "expenses"("company_id", "centre_id", "category_id", "date");

-- CreateIndex
CREATE INDEX "expenses_company_id_centre_id_date_idx" ON "expenses"("company_id", "centre_id", "date");

-- CreateIndex
CREATE INDEX "delivery_notes_company_id_centre_id_date_idx" ON "delivery_notes"("company_id", "centre_id", "date");

-- CreateIndex
CREATE INDEX "delivery_notes_status_idx" ON "delivery_notes"("status");

-- CreateIndex
CREATE INDEX "delivery_notes_vehicle_id_idx" ON "delivery_notes"("vehicle_id");

-- CreateIndex
CREATE INDEX "delivery_note_lines_delivery_note_id_idx" ON "delivery_note_lines"("delivery_note_id");

-- CreateIndex
CREATE INDEX "sales_company_id_centre_id_date_idx" ON "sales"("company_id", "centre_id", "date");

-- CreateIndex
CREATE INDEX "sales_company_id_centre_id_type_idx" ON "sales"("company_id", "centre_id", "type");

-- CreateIndex
CREATE INDEX "sales_delivery_note_id_idx" ON "sales"("delivery_note_id");

-- CreateIndex
CREATE INDEX "sale_lines_sale_id_idx" ON "sale_lines"("sale_id");

-- CreateIndex
CREATE INDEX "settlements_company_id_centre_id_date_idx" ON "settlements"("company_id", "centre_id", "date");

-- CreateIndex
CREATE INDEX "settlements_company_id_centre_id_party_id_idx" ON "settlements"("company_id", "centre_id", "party_id");

-- CreateIndex
CREATE INDEX "reserve_collections_company_id_centre_id_party_id_idx" ON "reserve_collections"("company_id", "centre_id", "party_id");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_entries_seq_key" ON "ledger_entries"("seq");

-- CreateIndex
CREATE INDEX "ledger_entries_company_id_centre_id_party_id_date_seq_idx" ON "ledger_entries"("company_id", "centre_id", "party_id", "date", "seq");

-- CreateIndex
CREATE INDEX "ledger_entries_source_type_source_id_idx" ON "ledger_entries"("source_type", "source_id");

-- CreateIndex
CREATE INDEX "attachments_linked_type_linked_id_idx" ON "attachments"("linked_type", "linked_id");

-- CreateIndex
CREATE INDEX "review_requests_company_id_centre_id_status_requested_at_idx" ON "review_requests"("company_id", "centre_id", "status", "requested_at");

-- CreateIndex
CREATE INDEX "review_requests_linked_type_linked_id_status_idx" ON "review_requests"("linked_type", "linked_id", "status");

-- AddForeignKey
ALTER TABLE "user_companies" ADD CONSTRAINT "user_companies_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_companies" ADD CONSTRAINT "user_companies_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "centres" ADD CONSTRAINT "centres_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_transporter_id_fkey" FOREIGN KEY ("transporter_id") REFERENCES "parties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_centre_id_fkey" FOREIGN KEY ("centre_id") REFERENCES "centres"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "parties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_lines" ADD CONSTRAINT "purchase_lines_purchase_id_fkey" FOREIGN KEY ("purchase_id") REFERENCES "purchases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_lines" ADD CONSTRAINT "purchase_lines_boat_id_fkey" FOREIGN KEY ("boat_id") REFERENCES "parties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_categories" ADD CONSTRAINT "expense_categories_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_lines" ADD CONSTRAINT "expense_lines_expense_id_fkey" FOREIGN KEY ("expense_id") REFERENCES "expenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_centre_id_fkey" FOREIGN KEY ("centre_id") REFERENCES "centres"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "parties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "expense_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_notes" ADD CONSTRAINT "delivery_notes_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_notes" ADD CONSTRAINT "delivery_notes_centre_id_fkey" FOREIGN KEY ("centre_id") REFERENCES "centres"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_notes" ADD CONSTRAINT "delivery_notes_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_notes" ADD CONSTRAINT "delivery_notes_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_notes" ADD CONSTRAINT "delivery_notes_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

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
ALTER TABLE "sales" ADD CONSTRAINT "sales_delivery_note_id_fkey" FOREIGN KEY ("delivery_note_id") REFERENCES "delivery_notes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_centre_id_fkey" FOREIGN KEY ("centre_id") REFERENCES "centres"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "parties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reserve_collections" ADD CONSTRAINT "reserve_collections_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reserve_collections" ADD CONSTRAINT "reserve_collections_centre_id_fkey" FOREIGN KEY ("centre_id") REFERENCES "centres"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reserve_collections" ADD CONSTRAINT "reserve_collections_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "parties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_centre_id_fkey" FOREIGN KEY ("centre_id") REFERENCES "centres"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "parties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_centre_id_fkey" FOREIGN KEY ("centre_id") REFERENCES "centres"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_requests" ADD CONSTRAINT "review_requests_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_requests" ADD CONSTRAINT "review_requests_centre_id_fkey" FOREIGN KEY ("centre_id") REFERENCES "centres"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_requests" ADD CONSTRAINT "review_requests_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_requests" ADD CONSTRAINT "review_requests_resolved_by_id_fkey" FOREIGN KEY ("resolved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
