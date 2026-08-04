-- Running-balance integrity.
--
-- Until now `running_balance` was computed by reading the single latest entry
-- for a party and adding a delta to it. That is only correct when entries are
-- written in strict chronological order and never edited. Any back-dated
-- voucher, any edit, and any delete left every later row in that party's
-- statement carrying a stale balance, and nothing ever repaired them.
--
-- This migration does three things:
--   1. adds `seq`, a monotonic tiebreaker, so (date, seq) is a *total* order
--      and a recompute is deterministic (created_at is only millisecond
--      precision, so rows written in one transaction can tie);
--   2. backfills `seq` in historical order so existing statements keep the
--      reading order they have always displayed;
--   3. recomputes every running balance from scratch, repairing rows that
--      have already drifted.

-- 1. Ordering column. SERIAL assigns in physical scan order for existing rows,
--    which is arbitrary, so step 2 immediately reassigns it.
ALTER TABLE "ledger_entries" ADD COLUMN "seq" SERIAL;

-- 2. Reassign in true chronological order. `id` breaks ties so the result is
--    reproducible rather than dependent on scan order.
WITH ordered AS (
    SELECT "id", row_number() OVER (ORDER BY "created_at", "id") AS rn
    FROM "ledger_entries"
)
UPDATE "ledger_entries" le
SET "seq" = ordered.rn
FROM ordered
WHERE le."id" = ordered."id";

-- Keep the sequence ahead of the backfilled values, or the next insert collides.
SELECT setval(
    pg_get_serial_sequence('ledger_entries', 'seq'),
    GREATEST(COALESCE((SELECT MAX("seq") FROM "ledger_entries"), 1), 1)
);

-- 3. Repair every party's chain. Partitioned per (company, centre, party)
--    because ledgers are isolated per centre; DEBIT adds, CREDIT subtracts,
--    matching ledgerDelta() in src/lib/ledger.ts.
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

-- CreateIndex
CREATE UNIQUE INDEX "ledger_entries_seq_key" ON "ledger_entries"("seq");

-- CreateIndex: covers the statement read and the recompute window, which
-- partitions on exactly this key.
CREATE INDEX "ledger_entries_company_id_centre_id_party_id_date_seq_idx"
    ON "ledger_entries"("company_id", "centre_id", "party_id", "date", "seq");

-- DropIndex: superseded by the wider index above.
DROP INDEX IF EXISTS "ledger_entries_company_id_centre_id_party_id_date_idx";
