import { redirect } from "next/navigation";
import { canEnter, requireSession } from "@/lib/session";
import { getActiveScope, scopeFieldValues } from "@/lib/centre";
import { liveVehicles } from "@/lib/vehicle";
import { peekDocumentNos, SERIES_PREFIX } from "@/lib/document-series";
import { createDelivery } from "../actions";
import { DeliveryForm } from "../delivery-form";
import { NoCentreNotice } from "../../../no-centre";

export default async function NewDeliveryPage() {
  const session = await requireSession();
  if (!canEnter(session.role)) redirect("/vouchers/deliveries");

  const { company, centre } = await getActiveScope();
  if (!centre) return <NoCentreNotice companyName={company.name} />;

  const [vehicles, nextNos] = await Promise.all([
    liveVehicles(company.id),
    peekDocumentNos(company.id, [SERIES_PREFIX.DELIVERY_NOTE]),
  ]);

  return (
    <div>
      <h1 className="heading text-xl font-semibold mb-1">New Delivery Note</h1>
      <p className="text-muted text-[13px] mb-4">
        A trip for {company.name} · {centre.name}. One truck, one buying day.
        The rent entered here is charged to that day once and credited to the
        transporter — it is not a separate expense voucher.
      </p>
      <DeliveryForm
        action={createDelivery}
        vehicles={vehicles}
        nextNo={nextNos[SERIES_PREFIX.DELIVERY_NOTE]}
        submitLabel="Save Delivery Note"
        scope={scopeFieldValues({ company, centre })}
      />
    </div>
  );
}
