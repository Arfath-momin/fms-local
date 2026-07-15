import Link from "next/link";
import { requireSession } from "@/lib/session";
import { getActiveCompany } from "@/lib/company";
import { getStockSummary } from "@/lib/stock";
import { fmtKg } from "@/lib/format";

// The four-part bar: visual proof that nothing is unaccounted for
// (design doc #5). Segment widths are proportions of total purchased.
function StockBar({
  available,
  inTransit,
  sold,
  loss,
  purchased,
}: {
  available: number;
  inTransit: number;
  sold: number;
  loss: number;
  purchased: number;
}) {
  if (purchased <= 0) return null;
  const pct = (n: number) => `${Math.max(0, (n / purchased) * 100)}%`;
  return (
    <div className="flex h-3 w-full border border-line-strong overflow-hidden">
      <div style={{ width: pct(available), background: "var(--credit)" }} />
      <div style={{ width: pct(inTransit), background: "var(--accent)" }} />
      <div style={{ width: pct(sold), background: "var(--line-strong)" }} />
      <div style={{ width: pct(loss), background: "var(--debit)" }} />
    </div>
  );
}

const LEGEND = [
  { label: "Available", color: "var(--credit)" },
  { label: "In Transit", color: "var(--accent)" },
  { label: "Sold", color: "var(--line-strong)" },
  { label: "Loss", color: "var(--debit)" },
];

export default async function StockReconciliationPage() {
  await requireSession();
  const company = await getActiveCompany();
  const rows = await getStockSummary(company.id);

  return (
    <div>
      <h1 className="heading text-xl font-semibold mb-1">
        Stock Reconciliation
      </h1>
      <p className="text-muted text-[13px] mb-4">
        {company.name} · Available + In Transit + Sold + Loss must always equal
        total purchased.
      </p>

      <div className="flex gap-4 mb-3 text-[12px]">
        {LEGEND.map((l) => (
          <span key={l.label} className="flex items-center gap-1.5">
            <span
              className="inline-block w-3 h-3 border border-line-strong"
              style={{ background: l.color }}
            />
            {l.label}
          </span>
        ))}
      </div>

      {rows.length === 0 ? (
        <p className="text-[13px] text-muted border border-line bg-surface px-4 py-3 max-w-lg">
          No stock movements for {company.name} yet. Enter a purchase to see
          stock here.
        </p>
      ) : (
        <div className="border border-line-strong bg-surface">
          <table className="ledger-table">
            <thead>
              <tr>
                <th>Fish Type</th>
                <th className="w-64">Composition</th>
                <th className="num-col">Available</th>
                <th className="num-col">In Transit</th>
                <th className="num-col">Sold</th>
                <th className="num-col">Loss</th>
                <th className="num-col">Purchased</th>
                <th>Check</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.fishType}>
                  <td className="font-medium">
                    <Link
                      href={`/reports/stock/${encodeURIComponent(r.fishType)}`}
                      className="text-accent underline underline-offset-2"
                    >
                      {r.fishType}
                    </Link>
                  </td>
                  <td>
                    <StockBar
                      available={Number(r.available)}
                      inTransit={Number(r.inTransit)}
                      sold={Number(r.sold)}
                      loss={Number(r.loss)}
                      purchased={Number(r.purchased)}
                    />
                  </td>
                  <td className="num-col num text-credit">
                    {fmtKg(r.available)}
                  </td>
                  <td className="num-col num">{fmtKg(r.inTransit)}</td>
                  <td className="num-col num">{fmtKg(r.sold)}</td>
                  <td className="num-col num text-debit">{fmtKg(r.loss)}</td>
                  <td className="num-col num font-semibold">
                    {fmtKg(r.purchased)}
                  </td>
                  <td>
                    {r.reconciles ? (
                      <span className="text-credit text-[12px] font-semibold">
                        ✓ Reconciled
                      </span>
                    ) : (
                      <span className="text-debit text-[12px] font-semibold">
                        ✕ Off by {fmtKg(Number(r.purchased) - Number(r.accounted))}
                      </span>
                    )}
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
