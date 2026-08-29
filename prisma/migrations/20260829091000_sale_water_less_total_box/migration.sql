-- The weighing slip as the buyer actually writes it, and the boxes it covers.
--
--   Total weight   900   as it arrived
--   Water less      50   what they deducted for water and ice
--   Net weight     850   derived, never typed
--
--   Total box       60   what this bill unloaded
--   Avg kg/box   14.167  derived: net ÷ total box
--
-- The average is what gives each Items row its weight — box × average — so the
-- merchant types boxes and a rate and the kilos follow. That is the way round
-- the mill actually works: they weigh the lot on arrival and nobody weighs a
-- single box.
--
-- `net_weight` already existed and is kept as the stored result rather than a
-- second typed figure that could disagree with total minus water.
ALTER TABLE "sales" ADD COLUMN "water_less" DECIMAL(12, 3);
ALTER TABLE "sales" ADD COLUMN "total_box"  INTEGER;
