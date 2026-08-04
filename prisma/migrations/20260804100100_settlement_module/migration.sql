-- Payments and receipts become first-class vouchers.
--
-- Settlement used to be implied by two flags: `purchases.paid` /
-- `expenses.paid` and `sales.amount_received`. Saving a voucher with those set
-- posted a hidden offsetting ledger row that reused the voucher's own id as its
-- source_id, so the trade and its settlement were a single indivisible record.
-- They could not be dated apart, paid in instalments, corrected separately, or
-- deleted independently.
--
-- This migration converts every implied settlement into a real Settlement row,
-- repoints the ledger entries it already produced at that row, and then drops
-- the flags so there is exactly one place that records money moving.
--
-- Balances are unaffected: the same ledger entries, with the same amounts,
-- dates and signs, simply point at a settlement voucher instead of at the
-- trade. Nothing is recomputed and no figure changes.

-- CreateEnum
CREATE TYPE "SettlementKind" AS ENUM ('PAYMENT', 'RECEIPT');
CREATE TYPE "SettlementMode" AS ENUM ('CASH', 'BANK', 'UPI', 'CHEQUE');

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

CREATE INDEX "settlements_company_id_centre_id_date_idx"
    ON "settlements"("company_id", "centre_id", "date");
CREATE INDEX "settlements_company_id_centre_id_party_id_idx"
    ON "settlements"("company_id", "centre_id", "party_id");

ALTER TABLE "settlements" ADD CONSTRAINT "settlements_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_centre_id_fkey"
    FOREIGN KEY ("centre_id") REFERENCES "centres"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_party_id_fkey"
    FOREIGN KEY ("party_id") REFERENCES "parties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_created_by_id_fkey"
    FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_updated_by_id_fkey"
    FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Data conversion
--
-- New ids are derived from the source voucher's id rather than generated, so
-- the migration is repeatable, and so a converted row can always be traced
-- back to the trade it was implied by.
-- ---------------------------------------------------------------------------

-- Paid purchases → PAYMENT vouchers.
INSERT INTO "settlements" (
    "id", "company_id", "centre_id", "party_id", "kind", "mode",
    "amount", "date", "notes", "created_at", "created_by_id"
)
SELECT
    'migrated-pay-' || p."id",
    p."company_id", p."centre_id", p."party_id",
    'PAYMENT', 'CASH',
    p."amount", p."date",
    'Converted from the “paid” flag on this purchase.',
    p."created_at", p."created_by_id"
FROM "purchases" p
WHERE p."paid" = true;

-- Paid expenses → PAYMENT vouchers.
INSERT INTO "settlements" (
    "id", "company_id", "centre_id", "party_id", "kind", "mode",
    "amount", "date", "notes", "created_at", "created_by_id"
)
SELECT
    'migrated-pay-' || e."id",
    e."company_id", e."centre_id", e."party_id",
    'PAYMENT', 'CASH',
    e."amount", e."date",
    'Converted from the “paid” flag on this expense.',
    e."created_at", e."created_by_id"
FROM "expenses" e
WHERE e."paid" = true;

-- Collected sales → RECEIPT vouchers. The ledger party is the CareOf agent
-- when the sale was routed through one, matching how the sale itself posted.
INSERT INTO "settlements" (
    "id", "company_id", "centre_id", "party_id", "kind", "mode",
    "amount", "date", "notes", "created_at", "created_by_id"
)
SELECT
    'migrated-rcp-' || s."id",
    s."company_id", s."centre_id",
    COALESCE(s."care_of_party_id", s."party_id"),
    'RECEIPT', 'CASH',
    s."amount_received", s."date",
    'Converted from the “amount received” field on this sale.',
    s."created_at", s."created_by_id"
FROM "sales" s
WHERE s."amount_received" > 0;

-- Repoint the ledger rows those flags produced. They already carry the right
-- amount, date and sign; only what they point at changes.
UPDATE "ledger_entries" le
SET "source_id" = 'migrated-pay-' || le."source_id"
WHERE le."source_type" = 'PAYMENT'
  AND EXISTS (
      SELECT 1 FROM "purchases" p
      WHERE p."id" = le."source_id" AND p."paid" = true
  );

UPDATE "ledger_entries" le
SET "source_id" = 'migrated-pay-' || le."source_id"
WHERE le."source_type" = 'PAYMENT'
  AND EXISTS (
      SELECT 1 FROM "expenses" e
      WHERE e."id" = le."source_id" AND e."paid" = true
  );

UPDATE "ledger_entries" le
SET "source_type" = 'RECEIPT',
    "source_id" = 'migrated-rcp-' || le."source_id"
WHERE le."source_type" = 'PAYMENT'
  AND EXISTS (
      SELECT 1 FROM "sales" s
      WHERE s."id" = le."source_id" AND s."amount_received" > 0
  );

-- ---------------------------------------------------------------------------
-- Retire the merged fields. Everything they recorded now lives in settlements.
-- ---------------------------------------------------------------------------
ALTER TABLE "purchases" DROP COLUMN "paid";
ALTER TABLE "expenses" DROP COLUMN "paid";
ALTER TABLE "sales" DROP COLUMN "amount_received";
