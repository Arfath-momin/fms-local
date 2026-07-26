-- Three-role model. MERCHANT becomes ADMIN (same powers, clearer name) and a
-- new ACCOUNTANT sits between it and AUDITOR: may enter vouchers, may never
-- edit one. Renaming rather than dropping the value means existing users keep
-- their access without a data migration.
ALTER TYPE "Role" RENAME VALUE 'MERCHANT' TO 'ADMIN';

-- AFTER 'ADMIN' keeps the database enum in the same order as schema.prisma, so
-- `prisma migrate diff` does not report drift.
ALTER TYPE "Role" ADD VALUE 'ACCOUNTANT' AFTER 'ADMIN';

-- Deactivation instead of deletion: vouchers point at their author.
ALTER TABLE "users" ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT true;
