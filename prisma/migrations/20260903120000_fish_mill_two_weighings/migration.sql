-- The two weighbridge readings behind a fish mill's total.
--
-- A mill weighs twice — once with the lots and the truck, once without — and
-- the difference is the load. The bill states both readings, then what came off
-- for water, then the net it paid on. The total itself is working, not a figure
-- anybody quotes, so it stays derived and off the printed bill.
--
-- `weight` keeps its meaning as the total, now derived from these two rather
-- than typed. Bills already on file have both columns null and their typed
-- total intact, so every one of them still reads and prices exactly as before.

ALTER TABLE "sales" ADD COLUMN "weight_first"  DECIMAL(12, 3);
ALTER TABLE "sales" ADD COLUMN "weight_second" DECIMAL(12, 3);
