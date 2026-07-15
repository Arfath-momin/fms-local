import Link from "next/link";

const COMING = [
  { label: "Balance Sheet", note: "Phase 6" },
  { label: "Profit & Loss", note: "Phase 6" },
  { label: "Party Statements", note: "Phase 6" },
];

export default function ReportsPage() {
  return (
    <div>
      <h1 className="heading text-xl font-semibold mb-4">Reports</h1>
      <div className="max-w-md border border-line bg-surface">
        <Link
          href="/reports/stock"
          className="block px-4 py-3 hover:bg-background border-b border-line"
        >
          <div className="font-semibold text-[14px]">Stock Reconciliation</div>
          <div className="text-muted text-[12px]">
            Available / In Transit / Sold / Loss per fish type — always sums to
            total purchased.
          </div>
        </Link>
        {COMING.map((c) => (
          <div
            key={c.label}
            className="px-4 py-3 border-b border-line last:border-b-0 opacity-50"
          >
            <div className="font-semibold text-[14px]">{c.label}</div>
            <div className="text-muted text-[12px]">Arrives in {c.note}.</div>
          </div>
        ))}
      </div>
    </div>
  );
}
