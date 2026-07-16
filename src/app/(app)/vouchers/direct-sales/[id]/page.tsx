import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { getStockSummary } from "@/lib/stock";
import { toInputDate } from "@/lib/format";
import { updateDirectSale } from "../actions";
import { DirectSaleForm } from "../direct-sale-form";

export default async function EditDirectSalePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireSession();
  const { id } = await params;
  if (session.role !== "MERCHANT") redirect("/vouchers/direct-sales");

  const sale = await prisma.directSale.findUnique({ where: { id } });
  if (!sale) notFound();

  const [buyers, stock, dayClose] = await Promise.all([
    prisma.party.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, type: true },
    }),
    getStockSummary(sale.companyId),
    prisma.dayClose.findUnique({
      where: {
        companyId_date: { companyId: sale.companyId, date: sale.date },
      },
    }),
  ]);

  if (dayClose) {
    return (
      <div>
        <h1 className="heading text-xl font-semibold mb-4">Edit Direct Sale</h1>
        <p className="text-[13px] border border-line bg-surface px-4 py-3 max-w-lg">
          This sale belongs to a closed day and can no longer be edited
          directly. Corrections to closed days go through the error-flag flow.
        </p>
      </div>
    );
  }

  // Editing frees this sale's own qty, so add it back to what's selectable.
  const fishOptions = stock
    .map((s) => ({
      fishType: s.fishType,
      available: (s.fishType === sale.fishType
        ? s.available.add(sale.qtyKg)
        : s.available
      ).toString(),
    }))
    .filter((s) => Number(s.available) > 0);

  return (
    <div>
      <h1 className="heading text-xl font-semibold mb-4">Edit Direct Sale</h1>
      <DirectSaleForm
        action={updateDirectSale.bind(null, sale.id)}
        buyers={buyers}
        fishOptions={fishOptions}
        initial={{
          partyId: sale.partyId,
          fishType: sale.fishType,
          qtyKg: sale.qtyKg.toString(),
          rate: sale.rate.toString(),
          amount: sale.amount.toString(),
          date: toInputDate(sale.date),
        }}
        submitLabel="Save Changes"
      />
    </div>
  );
}
