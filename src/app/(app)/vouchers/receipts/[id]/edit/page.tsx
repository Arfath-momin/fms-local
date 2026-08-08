import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getActiveScope, scopeFieldValues } from "@/lib/centre";
import { canEdit, requireSession } from "@/lib/session";
import { SETTLEMENT_KIND_LABELS } from "@/lib/settlement";
import { updateSettlement } from "../../../settlements/actions";
import { SettlementForm } from "../../../settlements/settlement-form";
import { settlementInitial } from "../../../settlements/views";

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireSession();
  const { id } = await params;
  if (!canEdit(session.role)) redirect(`/vouchers/receipts/${id}`);

  const { company, centre } = await getActiveScope();
  if (!centre) notFound();

  const settlement = await prisma.settlement.findFirst({
    // Scoped, not just found by id. A voucher belonging to another company or
    // centre must not open — let alone be editable — from the scope you are in.
    where: { id, companyId: company.id, centreId: centre.id },
    include: { party: { select: { name: true, type: true } } },
  });
  if (!settlement || settlement.kind !== "RECEIPT") notFound();

  return (
    <div>
      <h1 className="heading text-xl font-semibold mb-4">
        Edit {SETTLEMENT_KIND_LABELS.RECEIPT}
      </h1>
      <SettlementForm
        kind="RECEIPT"
        action={updateSettlement.bind(null, settlement.id, "RECEIPT")}
        initial={settlementInitial(settlement)}
        submitLabel="Save Changes"
        scope={scopeFieldValues({ company, centre })}
      />
    </div>
  );
}
