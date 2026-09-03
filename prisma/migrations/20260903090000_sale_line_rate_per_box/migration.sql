-- What a market paid for one BOX.
--
-- A market's bill is quoted per box, not per kilo: it states how many boxes it
-- took, what one weighed, and what it paid for each. Every other channel
-- reweighs on arrival and pays by weight, which is rate_per_kg.
--
-- Nullable, and null on every row already on file: market lines carried no rate
-- at all until now — the money was the typed net bill and the rows recorded
-- only which market took how many boxes.
--
-- A LOOSE row keeps using rate_per_kg. Fish too big to crate never went into a
-- box, so there is no per-box price to quote it at. Two columns rather than one
-- whose meaning changes with the pack: a figure that means two things is a
-- figure somebody eventually reads as the wrong one.

ALTER TABLE "sale_lines" ADD COLUMN "rate_per_box" DECIMAL(12, 2);
