import { redirect } from "next/navigation";
import { requireSession } from "@/lib/session";
import { getActiveCompany } from "@/lib/company";
import { createDelivery } from "../actions";
import { DeliveryForm } from "../delivery-form";

export default async function NewDeliveryPage() {
  const session = await requireSession();
  if (session.role !== "MERCHANT") redirect("/vouchers/deliveries");

  const company = await getActiveCompany();

  return (
    <div>
      <h1 className="heading text-xl font-semibold mb-1">New Delivery Note</h1>
      <p className="text-muted text-[13px] mb-4">
        Dispatching for {company.name}. Settle it later with the bill amount.
      </p>
      <DeliveryForm action={createDelivery} submitLabel="Save Delivery Note" />
    </div>
  );
}
