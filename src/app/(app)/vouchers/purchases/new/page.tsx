import { redirect } from "next/navigation";
import { canEnter, requireSession } from "@/lib/session";
import { getActiveScope, scopeFieldValues } from "@/lib/centre";
import { peekDocumentNos, SERIES_PREFIX } from "@/lib/document-series";
import { createPurchase } from "../actions";
import { PurchaseForm } from "../purchase-form";
import { NoCentreNotice } from "../../../no-centre";

export default async function NewPurchasePage() {
  const session = await requireSession();
  if (!canEnter(session.role)) redirect("/vouchers/purchases");

  const { company, centre } = await getActiveScope();
  if (!centre) return <NoCentreNotice companyName={company.name} />;

  // Both series, because the type is chosen inside the form — a Private bill
  // takes a PP number and a Local one an LP.
  const nextNos = await peekDocumentNos(company.id, [
    SERIES_PREFIX.PURCHASE_PRIVATE,
    SERIES_PREFIX.PURCHASE_LOCAL,
  ]);

  return (
    <div>
      <h1 className="heading text-xl font-semibold mb-1">New Purchase</h1>
      <p className="text-muted text-[13px] mb-4">
        Entering for {company.name} · {centre.name}.
      </p>
      <PurchaseForm
        nextNos={nextNos}
        action={createPurchase}
        submitLabel="Save Purchase"
        scope={scopeFieldValues({ company, centre })}
      />
    </div>
  );
}
