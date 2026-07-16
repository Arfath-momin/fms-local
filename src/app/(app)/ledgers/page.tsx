import Link from "next/link";

const COMING = [
  { label: "Party Ledgers", note: "Phase 5" },
  { label: "Expense Ledgers", note: "Phase 5" },
  { label: "Day Book", note: "Phase 5" },
];

export default function LedgersPage() {
  return (
    <div>
      <h1 className="heading text-xl font-semibold mb-4">Ledgers</h1>
      <div className="max-w-md border border-line bg-surface">
        <Link
          href="/ledgers/owner-reserve"
          className="block px-4 py-3 hover:bg-background border-b border-line"
        >
          <div className="font-semibold text-[14px]">
            Owner Reserve Account{" "}
            <span className="ml-1 text-[10px] uppercase tracking-wide border border-line-strong px-1.5 py-0.5 text-muted align-middle">
              internal
            </span>
          </div>
          <div className="text-muted text-[12px]">
            Running balance of amounts withheld on market bills.
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
