-- Market: cutting alongside reserve, and rent as a receipt rather than a
-- deduction.
--
-- TWO CHANGES, one of which moves existing money between columns.
--
-- 1. CUTTING. A second thing the market withholds, struck as a percentage of
--    the total bill the way commission is. The books already know how to carry
--    reserve — netted inside the net bill, balance derived per party, income on
--    the day it is collected — and cutting is the same animal under another
--    name, so it gets a column beside reserve and shares its collections table
--    through a `kind` discriminator.
--
-- 2. RENT IS NOT A DEDUCTION. The market bill used to read
--
--        total − commission − reserve − labour − RENT = net
--
--    so a market that paid the driver 15,000 was billed for 15,000 less. That
--    is not what happened. The market owes the whole net; handing the driver
--    15,000 is how it PAID part of what it owed. Same balance, but the
--    difference shows the moment anyone asks what the market was billed:
--
--        before   DEBIT 27,100                        →  owes 27,100
--        after    DEBIT 42,100 · CREDIT 15,000 receipt →  owes 27,100
--
--    The second is the one that matches the market's own paper, and the one
--    where "what did we bill them" and "what have they paid" are separate
--    questions with separate answers.
--
-- This migration converts every existing market bill that carried rent. It is
-- balance-neutral by construction — the debit grows by exactly what the new
-- credit takes away — and profit-neutral too, because revenue was already
-- grossed back up by the same figure and now simply reads the net.

ALTER TABLE "sales" ADD COLUMN "cutting" DECIMAL(14,2);
ALTER TABLE "sales" ADD COLUMN "cutting_rate" DECIMAL(5,2);

CREATE TYPE "WithholdingKind" AS ENUM ('RESERVE', 'CUTTING');
ALTER TABLE "reserve_collections"
  ADD COLUMN "kind" "WithholdingKind" NOT NULL DEFAULT 'RESERVE';

-- The net stops being net of rent.
UPDATE "sales"
   SET "amount" = "amount" + "rent_deducted"
 WHERE "type" = 'MARKET'
   AND "rent_deducted" IS NOT NULL
   AND "rent_deducted" > 0;

-- The bill debits what it now says.
UPDATE "ledger_entries" le
   SET "amount" = s."amount"
  FROM "sales" s
 WHERE le."source_id" = s."id"
   AND le."source_type" = 'SALE'
   AND le."type" = 'DEBIT'
   AND s."type" = 'MARKET'
   AND s."rent_deducted" IS NOT NULL
   AND s."rent_deducted" > 0;

-- And what the market handed the driver comes back as a receipt against it.
--
-- The party, company and centre are taken from the bill's OWN debit rather than
-- from the sale's `party_id`, because a bill raised care-of somebody posts to
-- the care-of party. The receipt has to land wherever the debit landed or it
-- credits a party who was never billed.
INSERT INTO "ledger_entries"
  ("id", "company_id", "centre_id", "party_id", "type",
   "source_type", "source_id", "amount", "date", "running_balance")
SELECT gen_random_uuid(), le."company_id", le."centre_id", le."party_id", 'CREDIT',
       'RECEIPT', s."id", s."rent_deducted", le."date", 0
  FROM "sales" s
  JOIN "ledger_entries" le
    ON le."source_id" = s."id"
   AND le."source_type" = 'SALE'
   AND le."type" = 'DEBIT'
 WHERE s."type" = 'MARKET'
   AND s."rent_deducted" IS NOT NULL
   AND s."rent_deducted" > 0;

-- Rebuild every chain. Same window function as recomputeRunningBalance() in
-- src/lib/ledger.ts — balances are derived, never patched.
WITH ordered AS (
  SELECT
    "id",
    SUM(CASE WHEN "type" = 'DEBIT' THEN "amount" ELSE -"amount" END)
      OVER (PARTITION BY "company_id", "centre_id", "party_id"
            ORDER BY "date", "seq" ROWS UNBOUNDED PRECEDING) AS rb
  FROM "ledger_entries"
)
UPDATE "ledger_entries" le
   SET "running_balance" = ordered.rb
  FROM ordered
 WHERE le."id" = ordered."id"
   AND le."running_balance" IS DISTINCT FROM ordered.rb;
