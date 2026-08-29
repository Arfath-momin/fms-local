-- The line man: the person who unloads the fish at the market.
--
-- He is paid per trip and gets a LEDGER, not a lump in "expense vendors". BFM
-- owes him trip by trip, and the box statement names whoever unloaded a given
-- load — which needs him to be a party with a type of his own rather than a
-- string on a voucher.

ALTER TYPE "PartyType" ADD VALUE IF NOT EXISTS 'LINE_MAN';

-- The head itself, for every company that already exists. New companies get it
-- from ensureDefaultExpenseCategories(); this is the same list, backfilled.
--
-- It slots in after RENT and before the overheads, so the pickers keep reading
-- direct costs first. The existing overhead rows shift down by one to make room
-- rather than leaving the new head tied with SALARY.
UPDATE "expense_categories"
   SET "sort_order" = "sort_order" + 1
 WHERE "code" IN ('SALARY', 'OFFICE_RENT', 'OTHER');

INSERT INTO "expense_categories"
  ("id", "company_id", "code", "name", "kind", "allows_lines", "sort_order")
SELECT gen_random_uuid(), c."id", 'LINE_MAN', 'Line Man', 'DIRECT', false, 6
  FROM "companies" c
 ON CONFLICT ("company_id", "code") DO NOTHING;
