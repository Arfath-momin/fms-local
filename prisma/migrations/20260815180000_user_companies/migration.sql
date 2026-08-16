-- Isolating BFM from B2B.
--
-- The two share this installation but are separate businesses with separate
-- partners, so an admin of one has no business reading the other's ledgers.
-- Until now any signed-in user could switch to any company, because nothing
-- recorded who was entitled to what.
--
-- The grant is the whole of the permission. The switcher renders from it and
-- getActiveCompany() refuses a cookie naming a company the user does not hold,
-- which is the choke point every company-scoped query already passes through —
-- that is what makes this a boundary rather than a hidden menu.
--
-- Existing users are granted EVERY company at the bottom of this file. Nobody
-- is locked out by deploying this; the merchant then narrows people down from
-- the Users screen. A migration that silently revoked access would be found out
-- at 4am at the quay, which is not when to discover a permissions change.

CREATE TABLE "user_companies" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_companies_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "user_companies_user_id_company_id_key"
  ON "user_companies"("user_id", "company_id");

CREATE INDEX "user_companies_user_id_idx" ON "user_companies"("user_id");

-- CASCADE on both sides: a grant is meaningless once either end is gone, and
-- these rows carry no history worth keeping (unlike vouchers, which is why
-- users are deactivated rather than deleted).
ALTER TABLE "user_companies" ADD CONSTRAINT "user_companies_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "user_companies" ADD CONSTRAINT "user_companies_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Grant every existing user every existing company, preserving today's
-- behaviour exactly. gen_random_uuid() is built in from Postgres 13.
INSERT INTO "user_companies" ("id", "user_id", "company_id")
SELECT gen_random_uuid(), u."id", c."id"
FROM "users" u
CROSS JOIN "companies" c;
