-- A vehicle-rent expense knows which trip it came off.
--
-- Spec §4 is explicit that a sale or expense links to its trip by
-- deliveryNoteId and never by matching date against vehicle text. Sales already
-- did. Expenses did not: recordTripRent and the market-bill rent path both
-- stashed the id in the `details` JSON as `{ "tripId": "..." }`, which no
-- foreign key protects, nothing can join through, and no report can read — so
-- the rent ledger could list a date, a transporter and an amount but not the
-- vehicle the rent was actually for.
--
-- Additive and lossless: the column is nullable, and every existing rent
-- expense is backfilled from the blob it was already carrying.

ALTER TABLE "expenses" ADD COLUMN "delivery_note_id" TEXT;

-- Backfill. The EXISTS guard matters: a trip deleted since the expense was
-- written leaves a dangling id in the JSON, and adopting it would fail the
-- foreign key added below.
UPDATE "expenses" e
   SET "delivery_note_id" = e."details"->>'tripId'
 WHERE e."details" IS NOT NULL
   AND e."details"->>'tripId' IS NOT NULL
   AND EXISTS (
     SELECT 1 FROM "delivery_notes" dn WHERE dn."id" = e."details"->>'tripId'
   );

-- ON DELETE SET NULL, not CASCADE. The rent is money that genuinely left the
-- business; deleting the delivery note is a correction to a record that "carries
-- no accounting", and it must not silently take a real expense with it. The
-- expense survives and merely stops naming a trip.
ALTER TABLE "expenses"
  ADD CONSTRAINT "expenses_delivery_note_id_fkey"
  FOREIGN KEY ("delivery_note_id") REFERENCES "delivery_notes"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "expenses_delivery_note_id_idx" ON "expenses"("delivery_note_id");
