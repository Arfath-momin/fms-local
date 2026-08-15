-- Itemised purchases for every type.
--
-- Two nullable columns, so every existing row and every existing query keeps
-- working untouched:
--
--   purchases.bill_no        the "No." on a Society/KFDC bill and the
--                            "Invoice No." on a Private/Local one. Deliberately
--                            not unique — paper bill books repeat numbers
--                            across centres and across years.
--
--   purchase_lines.boat_id   moves the boat from the bill header onto the line,
--                            because one Society bill covers several vessels.
--                            purchases.boat_id is kept: it holds every historic
--                            row and the party statement falls back to it.

ALTER TABLE "purchases" ADD COLUMN "bill_no" TEXT;

ALTER TABLE "purchase_lines" ADD COLUMN "boat_id" TEXT;

ALTER TABLE "purchase_lines"
  ADD CONSTRAINT "purchase_lines_boat_id_fkey"
  FOREIGN KEY ("boat_id") REFERENCES "parties"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Matches the header boat's index: lets "which bills name this vessel" stay an
-- index scan rather than a sequential read of every line ever written.
CREATE INDEX "purchase_lines_boat_id_idx" ON "purchase_lines"("boat_id");
