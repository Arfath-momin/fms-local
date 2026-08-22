import { redirect } from "next/navigation";
import { canEnter, requireSession } from "@/lib/session";
import { getActiveScope, scopeFieldValues } from "@/lib/centre";
import { reserveBalances } from "@/lib/reserve";
import { createReserveCollection } from "../actions";
import { ReserveCollectionForm } from "../reserve-form";
import { NoCentreNotice } from "../../../no-centre";

export default async function NewReserveCollectionPage() {
  const session = await requireSession();
  if (!canEnter(session.role)) redirect("/ledgers/reserve");

  const { company, centre } = await getActiveScope();
  if (!centre) return <NoCentreNotice companyName={company.name} />;

  const balances = await reserveBalances({
    companyId: company.id,
    centreId: centre.id,
  });

  return (
    <div>
      <h1 className="heading text-xl font-semibold mb-1">Collect Reserve</h1>
      <p className="text-muted text-[13px] mb-4">
        {company.name} · {centre.name}. Reserve is money a market party withheld
        from a bill and pays back later, usually at year end. It never sat in
        the trade ledger, so this records the money arriving and clears what
        that party holds — it settles no invoice.
      </p>
      <ReserveCollectionForm
        action={createReserveCollection}
        holdings={balances.map((b) => ({
          partyName: b.partyName,
          outstanding: b.outstanding.toNumber(),
        }))}
        scope={scopeFieldValues({ company, centre })}
      />
    </div>
  );
}
