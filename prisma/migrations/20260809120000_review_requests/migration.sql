-- Accountants can ask an admin to correct a voucher.
--
-- An accountant may enter a voucher but never edit one, so until now a mistake
-- spotted after saving had nowhere to go. A review request is that route: it
-- names what is wrong and lands on the admin's dashboard under the company and
-- centre the voucher was entered in.
--
-- Purely additive — no existing table, row or balance is touched.

-- CreateEnum
CREATE TYPE "ReviewLinkedType" AS ENUM ('PURCHASE', 'SALE', 'EXPENSE', 'DELIVERY_NOTE', 'PAYMENT', 'RECEIPT');
CREATE TYPE "ReviewStatus" AS ENUM ('OPEN', 'RESOLVED');

-- CreateTable
CREATE TABLE "review_requests" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "centre_id" TEXT NOT NULL,
    "linked_type" "ReviewLinkedType" NOT NULL,
    "linked_id" TEXT NOT NULL,
    "status" "ReviewStatus" NOT NULL DEFAULT 'OPEN',
    "reason" TEXT NOT NULL,
    "requested_by_id" TEXT,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_by_id" TEXT,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "review_requests_pkey" PRIMARY KEY ("id")
);

-- The dashboard read: open requests for one company and centre, newest first.
CREATE INDEX "review_requests_company_id_centre_id_status_requested_at_idx"
    ON "review_requests"("company_id", "centre_id", "status", "requested_at");
-- The voucher read: does this voucher have an open request against it?
CREATE INDEX "review_requests_linked_type_linked_id_status_idx"
    ON "review_requests"("linked_type", "linked_id", "status");

ALTER TABLE "review_requests" ADD CONSTRAINT "review_requests_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "review_requests" ADD CONSTRAINT "review_requests_centre_id_fkey"
    FOREIGN KEY ("centre_id") REFERENCES "centres"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- Accounts are deactivated, never deleted, so these should never fire; SET NULL
-- matches how every other authored row behaves rather than blocking a delete.
ALTER TABLE "review_requests" ADD CONSTRAINT "review_requests_requested_by_id_fkey"
    FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "review_requests" ADD CONSTRAINT "review_requests_resolved_by_id_fkey"
    FOREIGN KEY ("resolved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
