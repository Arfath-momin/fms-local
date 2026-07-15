import Link from "next/link";

const COMING = [
  { label: "Delivery Note", note: "Phase 3" },
  { label: "Settlement", note: "Phase 3" },
  { label: "Direct Sale", note: "Phase 4" },
  { label: "Expense", note: "Phase 5" },
];

export default function VouchersPage() {
  return (
    <div>
      <h1 className="heading text-xl font-semibold mb-4">Vouchers</h1>
      <div className="max-w-md border border-line bg-surface">
        <Link
          href="/vouchers/purchases"
          className="block px-4 py-3 hover:bg-background border-b border-line"
        >
          <div className="font-semibold text-[14px]">Purchase</div>
          <div className="text-muted text-[12px]">
            Society, private and local purchases. Adds stock, posts to the
            seller&apos;s ledger.
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
