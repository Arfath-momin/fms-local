import { requireEntry } from "@/lib/session";
import { getActiveScope, scopeFieldValues } from "@/lib/centre";
import { SETTLEMENT_KIND_BLURBS, SETTLEMENT_KIND_LABELS } from "@/lib/settlement";
import { createSettlement } from "../../settlements/actions";
import { SettlementForm } from "../../settlements/settlement-form";
import { NoCentreNotice } from "../../../no-centre";

export default async function Page() {
  await requireEntry();
  const { company, centre } = await getActiveScope();
  if (!centre) return <NoCentreNotice companyName={company.name} />;

  return (
    <div>
      <h1 className="heading text-xl font-semibold mb-1">
        New {SETTLEMENT_KIND_LABELS.PAYMENT}
      </h1>
      <p className="text-muted text-[13px] mb-4 max-w-xl">
        {SETTLEMENT_KIND_BLURBS.PAYMENT}
      </p>
      <p className="text-muted text-[13px] mb-4">
        Entering for {company.name} · {centre.name}.
      </p>
      <SettlementForm
        kind="PAYMENT"
        action={createSettlement.bind(null, "PAYMENT")}
        submitLabel="Save PAYMENT"
        scope={scopeFieldValues({ company, centre })}
      />
    </div>
  );
}
