-- Retiring a master without destroying its history.
--
-- Masters cannot simply be deleted: a party is referenced by purchases, purchase
-- lines, expenses, sales, settlements and every ledger entry ever posted against
-- it, and a centre owns all of those in turn. Removing the row would either be
-- refused by the foreign keys or, worse, take the history with it.
--
-- So retirement is a timestamp. An archived master keeps every row that points
-- at it and reads identically in ledgers, registers and reports; it only stops
-- being offered on the screens where new entries are made. A real DELETE stays
-- available, but only for masters nothing references at all — the mistyped name
-- that created a party on its first and only use.
--
--   SUPER_ADMIN   a fourth role above ADMIN. Archiving is destructive-looking
--                 but reversible, and un-archiving is how a mistake gets undone;
--                 both of those, plus the real DELETE, belong to the system
--                 owner rather than the merchant running the books. Added first
--                 in the enum so it sorts to the top of the users list.

ALTER TYPE "Role" ADD VALUE 'SUPER_ADMIN' BEFORE 'ADMIN';

ALTER TABLE "centres" ADD COLUMN "archived_at" TIMESTAMP(3);

ALTER TABLE "parties" ADD COLUMN "archived_at" TIMESTAMP(3);

-- Every read on the entry side filters to archived_at IS NULL. A partial index
-- keeps those lists to the live rows only, so the party picker does not get
-- slower as retired names accumulate behind it.
CREATE INDEX "parties_type_name_live_idx"
  ON "parties"("type", "name") WHERE "archived_at" IS NULL;

CREATE INDEX "centres_company_id_live_idx"
  ON "centres"("company_id") WHERE "archived_at" IS NULL;
