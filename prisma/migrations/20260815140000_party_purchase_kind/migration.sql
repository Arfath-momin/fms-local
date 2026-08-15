-- Narrowing purchase-party suggestions to the kind of purchase being entered.
--
-- Society, KFDC and every private and local seller are all PURCHASE_GROUP, and
-- deliberately so: what they have in common is that the money is owed to them,
-- which is what the ledger is keyed on. The cost was on the entry side — typing
-- a Private bill offered KFDC and every local seller as suggestions too.
--
-- So the kind lives beside the type rather than replacing it. The ledger, the
-- statements and the settlement flow are all keyed on `type` and none of them
-- read this column; it exists purely to shorten a dropdown.
--
-- Nullable, and null is a valid steady state: it means "no purchase has told us
-- yet", which is true of every party created by hand from Masters. A null-kind
-- party still appears under every kind, so nothing is ever hidden from the
-- person entering a bill.

ALTER TABLE "parties" ADD COLUMN "purchase_kind" "PurchaseType";

-- The type-ahead already filters on (type, name) among live rows; adding the
-- kind to that partial index keeps the narrowed lookup on the same index scan
-- rather than making the extra predicate a filter step over the results.
DROP INDEX IF EXISTS "parties_type_name_live_idx";

CREATE INDEX "parties_type_kind_name_live_idx"
  ON "parties"("type", "purchase_kind", "name") WHERE "archived_at" IS NULL;
