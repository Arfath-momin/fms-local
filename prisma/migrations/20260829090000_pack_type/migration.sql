-- Box, big box or loose — one kind per line.
--
-- A delivery note line carried three separate counts: box, big_box and loose,
-- any of which could be filled at once. In practice they never were — all 24
-- existing lines use `box` alone, and not one uses two kinds together — because
-- a consignment is packed one way, not three ways on the same row.
--
-- Naming the kind makes the difference that matters explicit: a BIG_BOX is
-- still a crate that goes out and comes back, and LOOSE is fish too big to box,
-- which goes straight onto the truck bed. Loose rows have no crate to send and
-- none to return, so they must stay OUT of every box tally rather than count as
-- zero and appear to balance.
--
-- Every existing row becomes BOX, which is what every existing row already is.
-- `big_box` and `loose` are left in place rather than dropped: they hold what
-- was recorded, and nothing is gained by destroying it.
CREATE TYPE "PackType" AS ENUM ('BOX', 'BIG_BOX', 'LOOSE');

ALTER TABLE "delivery_note_lines"
  ADD COLUMN "pack" "PackType" NOT NULL DEFAULT 'BOX';

ALTER TABLE "sale_lines"
  ADD COLUMN "pack" "PackType" NOT NULL DEFAULT 'BOX';
