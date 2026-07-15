import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { getActiveCompany } from "@/lib/company";
import { getStockSummary } from "@/lib/stock";
import { createDelivery } from "../actions";
import { DeliveryForm } from "../delivery-form";

export default async function NewDeliveryPage() {
  const session = await requireSession();
  if (session.role !== "MERCHANT") redirect("/vouchers/deliveries");

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
      <h1 className="heading text-xl font-semibold mb-1">New Delivery Note</h1>
      <p className="text-muted text-[13px] mb-4">
        Dispatching from {company.name} stock.
      </p>
      {fishOptions.length === 0 ? (
        <p className="text-[13px] text-muted border border-line bg-surface px-4 py-3 max-w-lg">
          No stock is available to dispatch. Enter a purchase first.
        </p>
      ) : (
        <DeliveryForm
          action={createDelivery}
          buyers={buyers}
          fishOptions={fishOptions}
          submitLabel="Dispatch"
        />
      )}
    </div>
  );
}
