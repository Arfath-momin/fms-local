import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { getActiveCompany } from "@/lib/company";
import { getStockSummary } from "@/lib/stock";
import { createDirectSale } from "../actions";
import { DirectSaleForm } from "../direct-sale-form";

export default async function NewDirectSalePage() {
  const session = await requireSession();
  if (session.role !== "MERCHANT") redirect("/vouchers/direct-sales");

  const company = await getActiveCompany();
  const [buyers, stock] = await Promise.all([
    prisma.party.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, type: true },
    }),
    getStockSummary(company.id),
  ]);

  const fishOptions = stock
    .filter((s) => s.available.greaterThan(0))
    .map((s) => ({ fishType: s.fishType, available: s.available.toString() }));

  return (
    <div>
      <h1 className="heading text-xl font-semibold mb-1">New Direct Sale</h1>
      <p className="text-muted text-[13px] mb-4">
        Selling from {company.name} stock — sold and paid in one step.
      </p>
      {fishOptions.length === 0 ? (
        <p className="text-[13px] text-muted border border-line bg-surface px-4 py-3 max-w-lg">
          No stock is available to sell. Enter a purchase first.
        </p>
      ) : (
        <DirectSaleForm
          action={createDirectSale}
          buyers={buyers}
          fishOptions={fishOptions}
          submitLabel="Save Sale"
        />
      )}
    </div>
  );
}
