-- Take the per-box rate back off a sale line.
--
-- It was added a day ago on the understanding that a market's bill is quoted
-- per box. The merchant has since said otherwise: a market bill's rows record
-- WHICH fish went and HOW MUCH of it, and the money is the net the market paid
-- — total less its commission, cutting, reserve and labour — with no per-row
-- price at all.
--
-- Dropped rather than left standing. A column nothing writes and nothing reads
-- is a question for whoever finds it next, and the answer is not in the code.
-- The kilos it was introduced alongside stay: those were a real gap, and a
-- market row that recorded no weight is what started this.

ALTER TABLE "sale_lines" DROP COLUMN IF EXISTS "rate_per_box";
