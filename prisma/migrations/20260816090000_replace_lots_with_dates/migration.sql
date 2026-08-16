-- Replacing lots with a second date on the voucher.
--
-- Lots modelled a consignment as its own entity with a code and a lifecycle.
-- The merchant's actual need turned out to be smaller: he already thinks of a
-- catch as "the 16th", so the purchase date IS the grouping key and no separate
-- object is needed. Selecting it on a sale is one date field, and the Day Book
-- then reports that day's purchases, sales and expenses together — which is the
-- profit figure that was wanted all along.
--
-- Both voucher tables therefore now carry two dates:
--
--   date       the accounting date — the buying day the row belongs to. Every
--              ledger entry, statement, register and report reads this and only
--              this, which is what makes a day's P/L come out right.
--   sale_date  when the sale actually happened
--   spent_on   when the expense money actually went out
--
-- The second one is record-only. Nothing that computes a figure reads it, so
-- adding it cannot move a balance.
--
-- Dropping lots loses no accounting: lot_id was a grouping key and nothing
-- else, and every row keeps the date the lot was derived from in the first
-- place. No amount, party or ledger entry is touched by this migration.

ALTER TABLE "sales" ADD COLUMN "sale_date" DATE;
ALTER TABLE "expenses" ADD COLUMN "spent_on" DATE;

-- Backfill the record-only date from the accounting date. Before this change
-- they were the same day by definition — the merchant had nowhere to say
-- otherwise — so this states what was already true rather than inventing it,
-- and leaves no nulls for the display code to fall back through.
UPDATE "sales" SET "sale_date" = "date" WHERE "sale_date" IS NULL;
UPDATE "expenses" SET "spent_on" = "date" WHERE "spent_on" IS NULL;

-- Lots, removed. Constraints first, then the columns, then the table.
ALTER TABLE "purchases" DROP CONSTRAINT IF EXISTS "purchases_lot_id_fkey";
ALTER TABLE "sales" DROP CONSTRAINT IF EXISTS "sales_lot_id_fkey";
ALTER TABLE "expenses" DROP CONSTRAINT IF EXISTS "expenses_lot_id_fkey";

DROP INDEX IF EXISTS "purchases_lot_id_idx";
DROP INDEX IF EXISTS "sales_lot_id_idx";
DROP INDEX IF EXISTS "expenses_lot_id_idx";

ALTER TABLE "purchases" DROP COLUMN IF EXISTS "lot_id";
ALTER TABLE "sales" DROP COLUMN IF EXISTS "lot_id";
ALTER TABLE "expenses" DROP COLUMN IF EXISTS "lot_id";

DROP TABLE IF EXISTS "lots";
DROP TYPE IF EXISTS "LotKind";
