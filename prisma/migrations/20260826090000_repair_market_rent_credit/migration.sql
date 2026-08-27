-- Repair the market-party rent double-count.
--
-- A market bill credited the market party whatever rent it had deducted, on the
-- reasoning that they were not out of pocket. But the NET the sale debits is the
-- figure off the market's own paper, and that net is ALREADY after the rent
-- deduction. Crediting it again subtracted the same rupee twice, so every market
-- party who paid their bill in full came out looking like a creditor:
--
--   total 45,000 − commission 900 − reserve 1,500 − labour 500
--                − rent 15,000  =  net 27,100
--   DEBIT 27,100, CREDIT 15,000  →  balance 12,100
--   they pay the 27,100 printed on the bill  →  balance −15,000
--
-- Only the CREDIT side was wrong. The matching DEBIT on the TRANSPORTER is
-- correct and stays: it is what closes his account when a market pays the driver
-- on our behalf. So this deletes RENT_BY_PARTY credits and nothing else.

DELETE FROM "ledger_entries"
 WHERE "source_type" = 'RENT_BY_PARTY'
   AND "type" = 'CREDIT';

-- Rebuild the running balances of every chain that just lost a row. Same window
-- function as recomputeRunningBalance() in src/lib/ledger.ts — balances are
-- derived, never patched, so the repair is a recompute rather than an
-- adjustment entry.
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

-- The "only one bill per trip may carry the rent" constraint guarded a rule that
-- no longer exists: no sale carries rent at all now. Dropping it rather than
-- leaving a unique index enforcing a concept the code has forgotten.
DROP INDEX IF EXISTS "sales_one_rent_carrier_per_trip";
