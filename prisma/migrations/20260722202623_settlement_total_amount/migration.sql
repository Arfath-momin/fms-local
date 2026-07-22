-- Settlement now tracks the bill's Total Amount separately from the Amount
-- Received, so partial buyer payments leave a tracked outstanding balance.
ALTER TABLE "settlements" ADD COLUMN "amount" DECIMAL(14,2);

-- Backfill: previously the full billed amount was always recorded as received.
UPDATE "settlements" SET "amount" = "amount_received";

ALTER TABLE "settlements" ALTER COLUMN "amount" SET NOT NULL;
