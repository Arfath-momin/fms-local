import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { getStockSummary } from "@/lib/stock";
import { toInputDate } from "@/lib/format";
import { correctDirectSale, updateDirectSale } from "../actions";
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

  const [buyers, stock, dayClose, flag] = await Promise.all([
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
    prisma.errorFlag.findUnique({
      where: {
        linkedType_linkedId: { linkedType: "DIRECT_SALE", linkedId: sale.id },
      },
    }),
  ]);

  if (flag) {
    return (
      <div>
        <h1 className="heading text-xl font-semibold mb-4">Direct Sale</h1>
        <div className="text-[13px] border border-debit bg-surface px-4 py-3 max-w-lg">
          <p className="font-semibold text-debit">
            This sale was flagged as an error and corrected.
          </p>
          {flag.reason && (
            <p className="mt-1 text-muted">Reason: {flag.reason}</p>
          )}
          {flag.correctingEntryId && (
            <p className="mt-1">
              <Link
                href={`/vouchers/direct-sales/${flag.correctingEntryId}`}
                className="text-accent underline underline-offset-2"
              >
                View the corrected entry →
              </Link>
            </p>
          )}
        </div>
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

  const initial = {
    partyId: sale.partyId,
    fishType: sale.fishType,
    qtyKg: sale.qtyKg.toString(),
    rate: sale.rate.toString(),
    amount: sale.amount.toString(),
    date: toInputDate(sale.date),
  };

  if (dayClose) {
    return (
      <div>
        <h1 className="heading text-xl font-semibold mb-1">
          Correct Direct Sale (closed day)
        </h1>
        <p className="text-[13px] text-muted mb-4 max-w-lg">
          This day is closed, so the original entry cannot be edited. Saving
          here flags the original as an error — it stays visible,
          struck-through — and records this corrected entry in its place.
        </p>
        <DirectSaleForm
          action={correctDirectSale.bind(null, sale.id)}
          buyers={buyers}
          fishOptions={fishOptions}
          initial={initial}
          submitLabel="Flag Original & Save Correction"
          reasonField
        />
      </div>
    );
  }

  return (
    <div>
      <h1 className="heading text-xl font-semibold mb-4">Edit Direct Sale</h1>
      <DirectSaleForm
        action={updateDirectSale.bind(null, sale.id)}
        buyers={buyers}
        fishOptions={fishOptions}
        initial={initial}
        submitLabel="Save Changes"
      />
    </div>
  );
}
