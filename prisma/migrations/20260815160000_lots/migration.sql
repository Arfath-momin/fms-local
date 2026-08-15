-- Per-consignment profit.
--
-- The business buys a day's fish and sells it over the following two or three
-- days, buying again in the middle. Profit asked of a date range therefore nets
-- Monday's sales against Tuesday's purchases and answers a question nobody
-- asked. A lot ties the buying to the selling and the costs that came of it, so
-- "what did Monday's fish make" is finally a question the data can answer.
--
-- Every foreign key here is NULLABLE and no existing row is touched by this
-- migration. That is deliberate: the date-range Profit report keeps reading
-- exactly what it reads today, and nothing breaks between deploying this and
-- running the backfill (scripts/backfill-lots.ts). The forms require a lot for
-- anything entered from now on; the database stays permissive so history
-- remains valid rather than becoming a pile of constraint violations.

CREATE TYPE "LotKind" AS ENUM ('CONSIGNMENT', 'OVERHEAD');

CREATE TABLE "lots" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "centre_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "opened_on" DATE NOT NULL,
    "kind" "LotKind" NOT NULL DEFAULT 'CONSIGNMENT',
    "closed_at" TIMESTAMP(3),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lots_pkey" PRIMARY KEY ("id")
);

-- The code is what the merchant reads and picks, so it has to be unique within
-- the scope they see it in. It is also what makes the day's-first-purchase
-- find-or-create safe against two purchases being saved at the same moment:
-- the loser of that race hits this constraint and retries the find.
CREATE UNIQUE INDEX "lots_company_id_centre_id_code_key"
  ON "lots"("company_id", "centre_id", "code");

-- "The open lots of this centre, newest first" — the dropdown query that runs
-- on every sale and expense form.
CREATE INDEX "lots_company_id_centre_id_closed_at_opened_on_idx"
  ON "lots"("company_id", "centre_id", "closed_at", "opened_on");

ALTER TABLE "lots" ADD CONSTRAINT "lots_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "lots" ADD CONSTRAINT "lots_centre_id_fkey"
  FOREIGN KEY ("centre_id") REFERENCES "centres"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "purchases" ADD COLUMN "lot_id" TEXT;
ALTER TABLE "sales" ADD COLUMN "lot_id" TEXT;
ALTER TABLE "expenses" ADD COLUMN "lot_id" TEXT;

ALTER TABLE "purchases" ADD CONSTRAINT "purchases_lot_id_fkey"
  FOREIGN KEY ("lot_id") REFERENCES "lots"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "sales" ADD CONSTRAINT "sales_lot_id_fkey"
  FOREIGN KEY ("lot_id") REFERENCES "lots"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "expenses" ADD CONSTRAINT "expenses_lot_id_fkey"
  FOREIGN KEY ("lot_id") REFERENCES "lots"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- The lot report groups each of these by lot_id, so each gets an index on it.
-- Without them, one lot's profit would be three sequential scans over every
-- purchase, sale and expense the business has ever recorded.
CREATE INDEX "purchases_lot_id_idx" ON "purchases"("lot_id");
CREATE INDEX "sales_lot_id_idx" ON "sales"("lot_id");
CREATE INDEX "expenses_lot_id_idx" ON "expenses"("lot_id");
