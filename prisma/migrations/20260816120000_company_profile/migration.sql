-- Companies become something a super admin can create and maintain.
--
-- Until now a company existed only if the seed script made one — there was no
-- way to add one from inside the app, so a new business meant editing a seed
-- file and running it against production, which is also the script that ships
-- accounts with published passwords. Making companies a managed master removes
-- the last reason to ever run that script on a live server.
--
-- Two groups of columns:
--
--   colour       identity. The band and switcher chip used to be two hardcoded
--                CSS rules keyed on the names "BFM" and "B2B", which meant any
--                third company rendered in the default blue and was
--                indistinguishable from BFM at a glance. Being certain whose
--                books are on screen is the app's first design rule, so the
--                colour has to belong to the company, not the stylesheet.
--
--   letterhead   what prints at the top of a sale bill or delivery note:
--                legal name, address, phone, email, contact person, GSTIN and
--                a logo.
--
-- Every column is nullable. Existing rows keep working untouched, and a company
-- can be created with nothing but a name — the paperwork details are rarely all
-- to hand at the moment someone needs the company to exist.

ALTER TABLE "companies" ADD COLUMN "colour" VARCHAR(7);
ALTER TABLE "companies" ADD COLUMN "legal_name" TEXT;
ALTER TABLE "companies" ADD COLUMN "address" TEXT;
ALTER TABLE "companies" ADD COLUMN "phone" TEXT;
ALTER TABLE "companies" ADD COLUMN "email" TEXT;
ALTER TABLE "companies" ADD COLUMN "contact_person" TEXT;
ALTER TABLE "companies" ADD COLUMN "gstin" TEXT;
ALTER TABLE "companies" ADD COLUMN "logo_key" TEXT;

-- The two original companies keep exactly the colours the stylesheet gave them,
-- so nothing changes visually for an existing installation on the day this
-- ships. Matched by name because that is what the old CSS rules keyed on.
UPDATE "companies" SET "colour" = '#1e4d8c' WHERE "name" = 'BFM' AND "colour" IS NULL;
UPDATE "companies" SET "colour" = '#7a4a12' WHERE "name" = 'B2B' AND "colour" IS NULL;
