import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { getActiveCompany } from "@/lib/company";
import { fmtDate, fmtKg } from "@/lib/format";

const SOURCE_LABELS = {
  PURCHASE: "Purchase",
  DELIVERY: "Delivery",
  SETTLEMENT: "Settlement",
  SETTLEMENT_RETURN: "Settlement Return",
  LOSS_WRITEOFF: "Loss Write-off",
  DIRECT_SALE: "Direct Sale",
};

const STATE_LABELS = {
  AVAILABLE: "Available",
  IN_TRANSIT: "In Transit",
  SOLD: "Sold",
  LOSS: "Loss",
};

// Drill-down for one fish type: the raw movement ledger behind the
// reconciliation totals (design: every number traceable to transactions).
export default async function StockMovementsPage({
  params,
}: {
  params: Promise<{ fishType: string }>;
}) {
  await requireSession();
  const company = await getActiveCompany();
  const fishType = decodeURIComponent((await params).fishType);

  const movements = await prisma.stockMovement.findMany({
    where: { companyId: company.id, fishType },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
  });

  return (
    <div>
      <div className="mb-4">
        <Link
          href="/reports/stock"
          className="text-muted text-[12px] underline underline-offset-2"
        >
          ← Stock Reconciliation
        </Link>
        <h1 className="heading text-xl font-semibold mt-1">
          Stock Movements — {fishType}
        </h1>
        <p className="text-muted text-[13px]">
          {company.name} · append-only ledger; every state change is an
          out/in pair.
        </p>
      </div>

      {movements.length === 0 ? (
        <p className="text-[13px] text-muted border border-line bg-surface px-4 py-3 max-w-lg">
          No movements recorded for {fishType}.
        </p>
      ) : (
        <div className="border border-line-strong bg-surface">
          <table className="ledger-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Source</th>
                <th>State</th>
                <th className="num-col">In</th>
                <th className="num-col">Out</th>
              </tr>
            </thead>
            <tbody>
              {movements.map((m) => (
                <tr key={m.id}>
                  <td className="whitespace-nowrap">{fmtDate(m.date)}</td>
                  <td>{SOURCE_LABELS[m.sourceType]}</td>
                  <td>{STATE_LABELS[m.state]}</td>
                  <td className="num-col num text-credit">
                    {m.direction === "IN" ? fmtKg(m.qtyKg) : ""}
                  </td>
                  <td className="num-col num text-debit">
                    {m.direction === "OUT" ? fmtKg(m.qtyKg) : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
