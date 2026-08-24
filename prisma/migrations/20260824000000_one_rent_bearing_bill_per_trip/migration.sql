-- At most ONE bill per trip may carry that trip's rent (spec §4).
--
-- The rule was already enforced in createSale/updateSale, but only as a
-- read-then-write: the "is another bill already carrying this?" query runs
-- outside the transaction that writes the sale, so two bills for the same trip
-- saved at the same moment both see nothing and both save. The result is the
-- trip's rent expensed twice and the transporter's ledger credited twice, with
-- no error anywhere — exactly the kind of silent doubling this system exists to
-- prevent.
--
-- A partial unique index makes the database the arbiter, which is the only
-- place a check like this can be race-free. It constrains nothing else: rows
-- with carries_rent = false, and bills with no trip, are all outside it.
CREATE UNIQUE INDEX "sales_one_rent_carrier_per_trip"
  ON "sales" ("delivery_note_id")
  WHERE "carries_rent" = true AND "delivery_note_id" IS NOT NULL;
