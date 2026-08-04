-- Purchase ledgers move from the individual boat to the group.
--
-- Until now a Society, KFDC or Private purchase posted to a ledger named after
-- the boat, so every vessel accumulated its own balance and there was no
-- Society ledger at all. The business tracks what it owes *Society*, with the
-- boat as a detail on each line — so the ledger belongs to the group and the
-- boat becomes a column.
--
-- This is the one migration in the set that deliberately changes reported
-- figures: per-boat balances are summed into their group. Nothing is lost —
-- each purchase keeps its boat in the new `boat_id` column, so every statement
-- row can still name the vessel, and the per-boat position is still derivable.
--
-- Sale-side counterparties (Fish Mills, Factories, Market buyers, CareOf
-- agents) are deliberately NOT collapsed. Those are real debtors you collect
-- from individually, and merging them would destroy the per-customer
-- outstanding that the receipt workflow depends on.

-- The boat/seller, kept for display.
ALTER TABLE "purchases" ADD COLUMN "boat_id" TEXT;
CREATE INDEX "purchases_boat_id_idx" ON "purchases"("boat_id");
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_boat_id_fkey"
    FOREIGN KEY ("boat_id") REFERENCES "parties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The four group ledgers. Ids are fixed strings so this migration is
-- repeatable and the rows are recognisable in the data.
INSERT INTO "parties" ("id", "name", "type", "created_at") VALUES
    ('party-group-society',  'Society',           'PURCHASE_GROUP', CURRENT_TIMESTAMP),
    ('party-group-kfdc',     'KFDC',              'PURCHASE_GROUP', CURRENT_TIMESTAMP),
    ('party-group-private',  'Private Parties',   'PURCHASE_GROUP', CURRENT_TIMESTAMP),
    ('party-group-local',    'Local Individuals', 'PURCHASE_GROUP', CURRENT_TIMESTAMP)
ON CONFLICT ("name", "type") DO NOTHING;

-- Move the boat off the ledger field and onto its own column, then point the
-- purchase at its group.
UPDATE "purchases" SET "boat_id" = "party_id" WHERE "boat_id" IS NULL;

UPDATE "purchases" SET "party_id" = CASE "type"
    WHEN 'SOCIETY' THEN 'party-group-society'
    WHEN 'KFDC'    THEN 'party-group-kfdc'
    WHEN 'PRIVATE' THEN 'party-group-private'
    WHEN 'LOCAL'   THEN 'party-group-local'
END;

-- Re-point the ledger rows those purchases produced.
UPDATE "ledger_entries" le
SET "party_id" = p."party_id"
FROM "purchases" p
WHERE le."source_type" = 'PURCHASE' AND le."source_id" = p."id";

-- Payments have to follow the debt they settle. If a purchase moves to the
-- Society ledger but the payment that cleared it stays on the boat, Society
-- shows money still owed and the boat shows a credit balance for a debt it
-- never held — the totals still net out, but every individual ledger is wrong.
--
-- Two passes, because payments reach a boat by two routes:

-- 1. Payments the settlement migration derived from a purchase's `paid` flag.
--    These are unambiguous: the id names the exact purchase they settle.
UPDATE "settlements" st
SET "party_id" = p."party_id"
FROM "purchases" p
WHERE st."id" = 'migrated-pay-' || p."id";

-- 2. Any other payment still sitting on a boat or local seller — one entered
--    by hand against the vessel. There is no link back to a specific purchase,
--    so the group is inferred from that boat's own trade in the same centre.
--    A boat that traded under more than one group (Society *and* Private, say)
--    is assigned to whichever it bought the most under; ordering by party_id
--    after the total keeps the choice deterministic rather than arbitrary.
WITH boat_group AS (
    SELECT DISTINCT ON (p."boat_id", p."company_id", p."centre_id")
           p."boat_id", p."company_id", p."centre_id", p."party_id" AS group_id
    FROM "purchases" p
    WHERE p."boat_id" IS NOT NULL
    GROUP BY p."boat_id", p."company_id", p."centre_id", p."party_id"
    ORDER BY p."boat_id", p."company_id", p."centre_id",
             SUM(p."amount") DESC, p."party_id"
)
UPDATE "settlements" st
SET "party_id" = bg.group_id
FROM boat_group bg, "parties" pa
WHERE st."party_id" = bg."boat_id"
  AND st."company_id" = bg."company_id"
  AND st."centre_id" = bg."centre_id"
  AND pa."id" = st."party_id"
  AND pa."type" IN ('BOAT', 'LOCAL_SELLER')
  AND st."kind" = 'PAYMENT';

UPDATE "ledger_entries" le
SET "party_id" = st."party_id"
FROM "settlements" st
WHERE le."source_type" = 'PAYMENT' AND le."source_id" = st."id";

-- Every affected chain now has entries from several former ledgers interleaved,
-- so the running balances must be rebuilt from scratch — the same window
-- function recomputeRunningBalance() uses in src/lib/ledger.ts.
WITH ordered AS (
    SELECT
        "id",
        SUM(CASE WHEN "type" = 'DEBIT' THEN "amount" ELSE -"amount" END)
            OVER (
                PARTITION BY "company_id", "centre_id", "party_id"
                ORDER BY "date", "seq"
                ROWS UNBOUNDED PRECEDING
            ) AS rb
    FROM "ledger_entries"
)
UPDATE "ledger_entries" le
SET "running_balance" = ordered.rb
FROM ordered
WHERE le."id" = ordered."id"
  AND le."running_balance" IS DISTINCT FROM ordered.rb;
