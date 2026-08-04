-- The group-ledger party type, added on its own.
--
-- Postgres refuses to use an enum value in the same transaction that adds it,
-- and Prisma wraps each migration in one, so the restructure that references
-- 'PURCHASE_GROUP' has to be the next migration rather than part of this file.
ALTER TYPE "PartyType" ADD VALUE IF NOT EXISTS 'PURCHASE_GROUP';
