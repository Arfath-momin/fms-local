import { redirect } from "next/navigation";
import { canEnter, requireSession } from "@/lib/session";
import { getActiveScope, scopeFieldValues } from "@/lib/centre";
import { createDelivery } from "../actions";
import { DeliveryForm } from "../delivery-form";
import { NoCentreNotice } from "../../../no-centre";

export default async function NewDeliveryPage() {
  const session = await requireSession();
  if (!canEnter(session.role)) redirect("/vouchers/deliveries");

  const { company, centre } = await getActiveScope();
  if (!centre) return <NoCentreNotice companyName={company.name} />;

  return (
    <div>
      <h1 className="heading text-xl font-semibold mb-1">New Delivery Note</h1>
      <p className="text-muted text-[13px] mb-4">
        Recording a dispatch for {company.name} · {centre.name}. This is a
        record only — no ledger or settlement.
      </p>
      <DeliveryForm
        action={createDelivery}
        submitLabel="Save Delivery Note"
        scope={scopeFieldValues({ company, centre })}
      />
    </div>
  );
}
