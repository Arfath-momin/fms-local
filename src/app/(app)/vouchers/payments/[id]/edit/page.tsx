import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
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
  if (!canEdit(session.role)) redirect(`/vouchers/payments/${id}`);

  const settlement = await prisma.settlement.findUnique({
    where: { id },
    include: { party: { select: { name: true, type: true } } },
  });
  if (!settlement || settlement.kind !== "PAYMENT") notFound();

  return (
    <div>
      <h1 className="heading text-xl font-semibold mb-4">
        Edit {SETTLEMENT_KIND_LABELS.PAYMENT}
      </h1>
      <SettlementForm
        kind="PAYMENT"
        action={updateSettlement.bind(null, settlement.id, "PAYMENT")}
        initial={settlementInitial(settlement)}
        submitLabel="Save Changes"
      />
    </div>
  );
}
