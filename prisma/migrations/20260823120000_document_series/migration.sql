-- Auto-numbering for the documents BFM issues itself.
--
-- A delivery note, a private or local purchase, and a local sale all originate
-- here — there is no counterparty bill to copy a number from — so the number is
-- ours to issue and must not repeat. A Society or KFDC bill, and a factory,
-- market or fish-mill sale, all arrive with a number on them and stay typed.
--
-- A counter row rather than max(bill_no) + 1: two clerks saving at the same
-- moment would both read the same maximum and both write the same number.
-- Incrementing this row inside the voucher's transaction serialises them.

-- CreateTable
CREATE TABLE "document_series" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "next" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "document_series_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "document_series_company_id_prefix_key"
    ON "document_series"("company_id", "prefix");

-- AddForeignKey
ALTER TABLE "document_series" ADD CONSTRAINT "document_series_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- Seed each existing company's counters past whatever numbers are already in
-- use, so a freshly numbered document can never collide with a hand-typed one
-- entered before this migration.
INSERT INTO "document_series" ("id", "company_id", "prefix", "next")
SELECT gen_random_uuid(), c."id", s."prefix", 1
  FROM "companies" c
 CROSS JOIN (VALUES ('DN'), ('PP'), ('LP'), ('LS')) AS s("prefix")
ON CONFLICT DO NOTHING;

-- Delivery notes are the only one of the four with existing rows worth
-- scanning: purchases and sales were typed with the counterparty's numbers.
UPDATE "document_series" ds
   SET "next" = GREATEST(
         ds."next",
         COALESCE((
           SELECT MAX(CAST(SUBSTRING(dn."bill_no" FROM '[0-9]+$') AS INTEGER)) + 1
             FROM "delivery_notes" dn
            WHERE dn."company_id" = ds."company_id"
              AND dn."bill_no" ~ '^DN-[0-9]+$'
         ), 1)
       )
 WHERE ds."prefix" = 'DN';
