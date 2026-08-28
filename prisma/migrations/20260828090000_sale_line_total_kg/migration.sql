-- A sale line's weight is the weight of the LINE, not of one box.
--
-- The merchant does not weigh boxes. A lot goes on the scale whole — 150 boxes,
-- 4,500 kg — and the per-box figure is an average that falls out of it. Asking
-- for "kgs per box" made the clerk do 4500 ÷ 150 in their head before they
-- could type anything, and a rounded average silently changed the money: 4,400
-- over 150 boxes is 29.333, which multiplies back to 4,399.95.
--
-- The delivery note already worked this way. This brings sale lines into line
-- with it, so one number means one thing on both documents.
--
-- Converts what is stored rather than reinterpreting it. `total` is NOT touched
-- and does not need to be: it was computed as box × kg × rate, which is the
-- same figure as the new qty_kg × rate. Only the column's meaning moves.
UPDATE "sale_lines"
   SET "qty_kg" = "qty_kg" * "box"
 WHERE "box" IS NOT NULL
   AND "box" > 0;
