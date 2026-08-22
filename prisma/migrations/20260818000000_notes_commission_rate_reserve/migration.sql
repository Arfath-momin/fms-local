-- Notes on every voucher, a per-sale commission rate, and the Market reserve.
--
-- Three changes that travel together because they are all driven by the same
-- request, and splitting them would mean three deploys of the same form.
--
-- 1. `notes` reaches the two voucher types that lacked it. Expenses and
--    settlements already had the column, so this closes the gap rather than
--    introducing the idea.
--
-- 2. Market commission stops being a fixed 2%. The AMOUNT was always stored;
--    what is new is `commission_rate`, which records the percentage each bill
--    was struck at so a historic bill keeps reading as the rate it was agreed
--    at after the house changes its terms. Existing rows are backfilled to 2.00
--    because that is, factually, the only rate the old code could produce.
--
-- 3. `reserve` is money withheld from a Market seller. It is deliberately NOT
--    added into `amount`: the net bill is what the seller owes for the fish,
--    and folding a retention into it would misstate both the debt and the
--    day's revenue.
--
-- All columns are nullable and every enum value is additive, so this applies to
-- a populated database without touching a single existing row's meaning.

-- AlterTable
ALTER TABLE "purchases"      ADD COLUMN IF NOT EXISTS "notes" TEXT;
ALTER TABLE "sales"          ADD COLUMN IF NOT EXISTS "notes" TEXT;
ALTER TABLE "delivery_notes" ADD COLUMN IF NOT EXISTS "notes" TEXT;

-- AlterTable
ALTER TABLE "sales" ADD COLUMN IF NOT EXISTS "commission_rate" DECIMAL(5,2);
ALTER TABLE "sales" ADD COLUMN IF NOT EXISTS "reserve" DECIMAL(14,2);

-- Backfill: every commission already recorded was computed at the old fixed
-- 2%, so stamping the rate makes historic bills self-describing instead of
-- leaving them to be read against whatever rate is current.
UPDATE "sales"
   SET "commission_rate" = 2.00
 WHERE "commission" IS NOT NULL
   AND "commission_rate" IS NULL;

-- AlterEnum
-- Additive only. RESERVE mirrors COMMISSION: a standing account per
-- company/centre, posted by the sale action through the ordinary ledger
-- machinery, so the reserve statement is a normal party statement.
ALTER TYPE "PartyType"        ADD VALUE IF NOT EXISTS 'RESERVE';
ALTER TYPE "LedgerSourceType" ADD VALUE IF NOT EXISTS 'RESERVE';

-- The standing commission account was named for the rate it charged, which
-- stops being true the moment the rate is per-sale. Renamed in place so the
-- existing ledger and its history follow the rename rather than being orphaned
-- behind a party nothing posts to any more.
UPDATE "parties"
   SET "name" = 'Commission'
 WHERE "type" = 'COMMISSION'
   AND "name" = 'Commission (2%)';
