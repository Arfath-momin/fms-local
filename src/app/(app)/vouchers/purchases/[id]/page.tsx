import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { getKnownFishTypes } from "@/lib/stock";
import { toInputDate } from "@/lib/format";
import { updatePurchase } from "../actions";
import { PurchaseForm } from "../purchase-form";

export default async function EditPurchasePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireSession();
  if (session.role !== "MERCHANT") redirect("/vouchers/purchases");

  const { id } = await params;
  const purchase = await prisma.purchase.findUnique({ where: { id } });
  if (!purchase) notFound();

  const [parties, fishTypes, dayClose] = await Promise.all([
    prisma.party.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, type: true },
    }),
    getKnownFishTypes(purchase.companyId),
    prisma.dayClose.findUnique({
      where: {
        companyId_date: {
          companyId: purchase.companyId,
          date: purchase.date,
        },
      },
    }),
  ]);

  if (dayClose) {
    return (
      <div>
        <h1 className="heading text-xl font-semibold mb-4">Edit Purchase</h1>
        <p className="text-[13px] border border-line bg-surface px-4 py-3 max-w-lg">
          This purchase belongs to a closed day and can no longer be edited
          directly. Corrections to closed days go through the error-flag flow.
        </p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="heading text-xl font-semibold mb-4">Edit Purchase</h1>
      <PurchaseForm
        action={updatePurchase.bind(null, purchase.id)}
        parties={parties}
        fishTypes={fishTypes}
        initial={{
          type: purchase.type,
          partyId: purchase.partyId,
          invoiceNumber: purchase.invoiceNumber,
          fishType: purchase.fishType,
          qtyKg: purchase.qtyKg.toString(),
          amount: purchase.amount.toString(),
          date: toInputDate(purchase.date),
        }}
        submitLabel="Save Changes"
      />
    </div>
  );
}
