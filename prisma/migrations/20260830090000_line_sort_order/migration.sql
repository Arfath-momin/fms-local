-- Give a voucher's rows the order they were typed in.
--
-- Every line table was read `ORDER BY id`, and the id is a random UUID — so the
-- order was arbitrary to begin with, and an EDIT made it arbitrary AGAIN: saving
-- deletes every line and recreates it with a fresh uuid. A merchant who
-- corrected the third row of a delivery note and found the whole table
-- rearranged had no way to tell whether the correction had taken.
--
-- Existing rows are numbered in the order they currently display, so no voucher
-- already on file appears to change when this lands.

ALTER TABLE "delivery_note_lines" ADD COLUMN "sort_order" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "sale_lines"          ADD COLUMN "sort_order" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "purchase_lines"      ADD COLUMN "sort_order" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "expense_lines"       ADD COLUMN "sort_order" INTEGER NOT NULL DEFAULT 0;

UPDATE "delivery_note_lines" l SET "sort_order" = o.rn - 1
  FROM (SELECT "id", ROW_NUMBER() OVER (PARTITION BY "delivery_note_id" ORDER BY "id") AS rn
          FROM "delivery_note_lines") o
 WHERE o."id" = l."id";

UPDATE "sale_lines" l SET "sort_order" = o.rn - 1
  FROM (SELECT "id", ROW_NUMBER() OVER (PARTITION BY "sale_id" ORDER BY "id") AS rn
          FROM "sale_lines") o
 WHERE o."id" = l."id";

UPDATE "purchase_lines" l SET "sort_order" = o.rn - 1
  FROM (SELECT "id", ROW_NUMBER() OVER (PARTITION BY "purchase_id" ORDER BY "id") AS rn
          FROM "purchase_lines") o
 WHERE o."id" = l."id";

UPDATE "expense_lines" l SET "sort_order" = o.rn - 1
  FROM (SELECT "id", ROW_NUMBER() OVER (PARTITION BY "expense_id" ORDER BY "id") AS rn
          FROM "expense_lines") o
 WHERE o."id" = l."id";
