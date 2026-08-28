-- A cost can be entered on the sale that revealed it.
--
-- The real costs of a trip are not knowable when the truck leaves. The rent
-- depends on where it ends up going; the ice, the loaders and the rest land as
-- the day goes on. They ARE known when the bill comes back — at which point the
-- merchant is already on the sale screen with the paper in their hand, and was
-- being sent to a different screen to type them.
--
-- So a bill may now raise its own expenses, and this column is what ties them
-- to it: editing the bill edits them, and deleting it takes them with it.
-- Null on every expense entered the ordinary way, from Vouchers → Expenses.
--
-- Additive and nullable: every existing expense keeps working untouched.
ALTER TABLE "expenses" ADD COLUMN "sale_id" TEXT;

-- SET NULL, not CASCADE. The application deletes these rows explicitly inside
-- the sale's own transaction, so that their LEDGER entries go with them and the
-- affected balances are recomputed. A silent database cascade would drop the
-- expense and leave its ledger entry behind, which is exactly the kind of
-- orphan the running-balance chain cannot survive.
ALTER TABLE "expenses"
  ADD CONSTRAINT "expenses_sale_id_fkey"
  FOREIGN KEY ("sale_id") REFERENCES "sales"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "expenses_sale_id_idx" ON "expenses"("sale_id");
