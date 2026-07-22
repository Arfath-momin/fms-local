import { redirect } from "next/navigation";
import { requireSession } from "@/lib/session";
import { getActiveCompany } from "@/lib/company";
import { createPurchase } from "../actions";
import { PurchaseForm } from "../purchase-form";

export default async function NewPurchasePage() {
  const session = await requireSession();
  if (session.role !== "MERCHANT") redirect("/vouchers/purchases");

  const company = await getActiveCompany();

  return (
    <div>
      <h1 className="heading text-xl font-semibold mb-1">New Purchase</h1>
      <p className="text-muted text-[13px] mb-4">Entering for {company.name}.</p>
      <PurchaseForm action={createPurchase} submitLabel="Save Purchase" />
    </div>
  );
}
