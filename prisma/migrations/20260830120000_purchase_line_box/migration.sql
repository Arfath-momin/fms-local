-- Boxes on a Private or Local purchase line.
--
-- Those sellers land fish in boxes and quote what one box weighs, so the row's
-- weight is box × kg-per-box rather than a figure anybody weighed directly. A
-- Society or KFDC bill states its kilos and leaves this at zero, which is what
-- the default gives every row already on file.
--
-- The per-box weight is deliberately NOT a column: it is qty_kg / box, derived
-- wherever it is shown. Two stored figures that must agree are two figures that
-- can disagree, and the delivery note settled this the same way.

ALTER TABLE "purchase_lines" ADD COLUMN "box" INTEGER NOT NULL DEFAULT 0;
