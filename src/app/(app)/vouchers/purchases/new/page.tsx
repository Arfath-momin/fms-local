import { redirect } from "next/navigation";
import { canEnter, requireSession } from "@/lib/session";
import { getActiveScope } from "@/lib/centre";
import { createPurchase } from "../actions";
import { PurchaseForm } from "../purchase-form";
import { NoCentreNotice } from "../../../no-centre";

export default async function NewPurchasePage() {
  const session = await requireSession();
  if (!canEnter(session.role)) redirect("/vouchers/purchases");

  const { company, centre } = await getActiveScope();
  if (!centre) return <NoCentreNotice companyName={company.name} />;

  return (
    <div>
      <h1 className="heading text-xl font-semibold mb-1">New Purchase</h1>
      <p className="text-muted text-[13px] mb-4">
        Entering for {company.name} · {centre.name}.
      </p>
      <PurchaseForm action={createPurchase} submitLabel="Save Purchase" />
    </div>
  );
}
