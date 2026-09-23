/*
  Warnings:

  - A unique constraint covering the columns `[company_id,centre_id,party_id,bill_no]` on the table `purchases` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[company_id,centre_id,party_id,bill_no]` on the table `sales` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "purchases_company_id_centre_id_party_id_bill_no_key" ON "purchases"("company_id", "centre_id", "party_id", "bill_no");

-- CreateIndex
CREATE UNIQUE INDEX "sales_company_id_centre_id_party_id_bill_no_key" ON "sales"("company_id", "centre_id", "party_id", "bill_no");
