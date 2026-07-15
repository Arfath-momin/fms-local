import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { getActiveCompany } from "@/lib/company";
import { getKnownFishTypes } from "@/lib/stock";
import { createPurchase } from "../actions";
import { PurchaseForm } from "../purchase-form";

export default async function NewPurchasePage() {
  const session = await requireSession();
  if (session.role !== "MERCHANT") redirect("/vouchers/purchases");

  const company = await getActiveCompany();
  const [parties, fishTypes] = await Promise.all([
    prisma.party.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, type: true },
    }),
    getKnownFishTypes(company.id),
  ]);

  return (
    <div>
      <h1 className="heading text-xl font-semibold mb-1">New Purchase</h1>
      <p className="text-muted text-[13px] mb-4">Entering for {company.name}.</p>
      <PurchaseForm
        action={createPurchase}
        parties={parties}
        fishTypes={fishTypes}
        submitLabel="Save Purchase"
      />
    </div>
  );
}
