import { requireEntry } from "@/lib/session";
import { SETTLEMENT_KIND_BLURBS, SETTLEMENT_KIND_LABELS } from "@/lib/settlement";
import { createSettlement } from "../../settlements/actions";
import { SettlementForm } from "../../settlements/settlement-form";

export default async function Page() {
  await requireEntry();
  return (
    <div>
      <h1 className="heading text-xl font-semibold mb-1">
        New {SETTLEMENT_KIND_LABELS.RECEIPT}
      </h1>
      <p className="text-muted text-[13px] mb-4 max-w-xl">
        {SETTLEMENT_KIND_BLURBS.RECEIPT}
      </p>
      <SettlementForm
        kind="RECEIPT"
        action={createSettlement.bind(null, "RECEIPT")}
        submitLabel="Save RECEIPT"
      />
    </div>
  );
}
