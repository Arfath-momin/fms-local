-- Rent vouchers can be tied to a vehicle even when no trip exists yet.
-- Nullable preserves all existing expenses and their historical details.
ALTER TABLE "expenses" ADD COLUMN "vehicle_id" TEXT;

CREATE INDEX "expenses_vehicle_id_idx" ON "expenses"("vehicle_id");

ALTER TABLE "expenses"
ADD CONSTRAINT "expenses_vehicle_id_fkey"
FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
