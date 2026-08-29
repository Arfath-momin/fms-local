-- The empty-crate account: what each market is still holding.
--
-- Crates are BFM's property. They go out full, the market keeps them while it
-- sells, and the empties come back on some later trip — so at any moment a
-- market holds a number of them, and that number is a debt in wood rather than
-- in rupees.
--
-- Entered by hand, one row per market per trip. An earlier attempt derived the
-- whole account from the bills and was abandoned: a crate can come back on a
-- different trip from the one it left on, come back broken, or never come back,
-- and none of that appears on any bill. A count on the ground is the only
-- truthful source.
--
-- `seq` exists for the reason ledger_entries has one — two rows on one day tie
-- on date alone, and a tie makes a running total non-deterministic.
--
-- The balance is DERIVED from these rows, never stored.

-- CreateTable
CREATE TABLE "crate_entries" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "centre_id" TEXT NOT NULL,
    "party_id" TEXT NOT NULL,
    "seq" SERIAL NOT NULL,
    "date" DATE NOT NULL,
    "delivery_note_id" TEXT,
    "place" TEXT,
    "boxes_out" INTEGER NOT NULL DEFAULT 0,
    "boxes_returned" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3),
    "created_by_id" TEXT,
    "updated_by_id" TEXT,

    CONSTRAINT "crate_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "crate_entries_seq_key" ON "crate_entries"("seq");

-- CreateIndex
CREATE INDEX "crate_entries_company_id_centre_id_party_id_date_seq_idx" ON "crate_entries"("company_id", "centre_id", "party_id", "date", "seq");

-- CreateIndex
CREATE INDEX "crate_entries_delivery_note_id_idx" ON "crate_entries"("delivery_note_id");

-- AddForeignKey
ALTER TABLE "crate_entries" ADD CONSTRAINT "crate_entries_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crate_entries" ADD CONSTRAINT "crate_entries_centre_id_fkey" FOREIGN KEY ("centre_id") REFERENCES "centres"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crate_entries" ADD CONSTRAINT "crate_entries_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "parties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crate_entries" ADD CONSTRAINT "crate_entries_delivery_note_id_fkey" FOREIGN KEY ("delivery_note_id") REFERENCES "delivery_notes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crate_entries" ADD CONSTRAINT "crate_entries_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crate_entries" ADD CONSTRAINT "crate_entries_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
