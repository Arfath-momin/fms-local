-- Enum values for the settlement module, added on their own.
--
-- Postgres refuses to *use* a value added by ALTER TYPE ... ADD VALUE inside
-- the same transaction that added it ("unsafe use of new value of enum type").
-- Prisma wraps each migration in a transaction, so the values have to land in
-- their own migration and the data conversion that references them follows in
-- the next one.

-- Money in, as distinct from money out, and the house's own commission income.
ALTER TYPE "LedgerSourceType" ADD VALUE IF NOT EXISTS 'RECEIPT';
ALTER TYPE "LedgerSourceType" ADD VALUE IF NOT EXISTS 'COMMISSION';

-- The 2% commission account is modelled as a party so its ledger is an
-- ordinary statement instead of a parallel reporting table.
ALTER TYPE "PartyType" ADD VALUE IF NOT EXISTS 'COMMISSION';
