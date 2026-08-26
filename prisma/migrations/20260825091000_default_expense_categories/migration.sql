-- Give every EXISTING company the standard expense heads.
--
-- These were only ever created by scripts/seed.ts, so a company made from the
-- Companies screen — or by bootstrap on a fresh server — started with an empty
-- list. That is not merely inconvenient: recordTripRent and the market-bill
-- rent path both look the RENT head up by code and throw without it, so such a
-- company could raise a delivery note and then be unable to close it.
--
-- New companies are provisioned in code now (ensureDefaultExpenseCategories).
-- This is the one-off catch-up for companies that already exist.
--
-- Safe to the point of dullness: it INSERTs only what is missing, keyed on the
-- table's own (company_id, code) unique constraint. It renames nothing,
-- reclassifies nothing, and re-creates nothing that was archived — an archived
-- head still occupies its code, so ON CONFLICT leaves the merchant's decision
-- to retire it standing.
INSERT INTO "expense_categories" ("id", "company_id", "code", "name", "kind", "allows_lines", "sort_order", "created_at")
SELECT
  gen_random_uuid(),
  c."id",
  d."code",
  d."name",
  d."kind"::"ExpenseKind",
  d."allows_lines",
  d."sort_order",
  now()
FROM "companies" c
CROSS JOIN (VALUES
  ('ICE',         'Ice',          'DIRECT',   false, 0),
  ('LOADERS',     'Loaders',      'DIRECT',   false, 1),
  ('LADIES',      'Ladies',       'DIRECT',   false, 2),
  ('BATHA',       'Batha',        'DIRECT',   false, 3),
  ('CANTEEN',     'Canteen',      'DIRECT',   false, 4),
  ('RENT',        'Vehicle Rent', 'DIRECT',   false, 5),
  ('SALARY',      'Salaries',     'OVERHEAD', false, 6),
  ('OFFICE_RENT', 'Office Rent',  'OVERHEAD', false, 7),
  ('OTHER',       'Other',        'OVERHEAD', true,  8)
) AS d("code", "name", "kind", "allows_lines", "sort_order")
ON CONFLICT ("company_id", "code") DO NOTHING;
