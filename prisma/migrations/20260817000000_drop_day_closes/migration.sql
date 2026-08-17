-- Drop the retired day-close feature.
--
-- Day closing was removed from the application long ago: an Admin may edit any
-- voucher at any time, and only an Admin may edit at all. The table was left in
-- place in case the feature came back. It did not — nothing has read or written
-- `day_closes` since, the helper module (src/lib/dayclose.ts) had no callers,
-- and production held 0 rows at the time this migration was written.
--
-- Verified empty before writing this:
--   select count(*) from day_closes;  -> 0
--
-- The FK constraints are dropped explicitly before the table rather than relying
-- on DROP TABLE to remove them, so this reads correctly against a database where
-- only some of the objects survive. Every statement is IF EXISTS so re-running
-- is harmless.
--
-- error_flags is deliberately untouched. It was retired at the same time as day
-- closing, but its rows are still READ — a flagged voucher renders struck
-- through and is excluded from report totals — so it stays.

-- DropForeignKey
-- `ALTER TABLE IF EXISTS`, not a bare ALTER: the trailing DROP TABLE removes
-- these constraints too, so on a re-run the table is already gone and a bare
-- ALTER would abort the migration on a missing relation.
ALTER TABLE IF EXISTS "day_closes" DROP CONSTRAINT IF EXISTS "day_closes_company_id_fkey";
ALTER TABLE IF EXISTS "day_closes" DROP CONSTRAINT IF EXISTS "day_closes_centre_id_fkey";

-- DropIndex
DROP INDEX IF EXISTS "day_closes_company_id_centre_id_date_key";

-- DropTable
DROP TABLE IF EXISTS "day_closes";
