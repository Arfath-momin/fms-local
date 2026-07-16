import Link from "next/link";

const COMING: { label: string; note: string }[] = [];

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
        <Link
          href="/vouchers/deliveries"
          className="block px-4 py-3 hover:bg-background border-b border-line"
        >
          <div className="font-semibold text-[14px]">
            Delivery Note &amp; Settlement
          </div>
          <div className="text-muted text-[12px]">
            Dispatch stock to factory, market, mill or local buyers; settle
            with accepted / returned / spoiled splits.
          </div>
        </Link>
        <Link
          href="/vouchers/direct-sales"
          className="block px-4 py-3 hover:bg-background border-b border-line"
        >
          <div className="font-semibold text-[14px]">Direct Sale</div>
          <div className="text-muted text-[12px]">
            Quick local sale — stock sold and paid in one step, no delivery
            note.
          </div>
        </Link>
        <Link
          href="/vouchers/expenses"
          className="block px-4 py-3 hover:bg-background border-b border-line"
        >
          <div className="font-semibold text-[14px]">Expense</div>
          <div className="text-muted text-[12px]">
            Loaders, workers, ice, canteen, rent, transport, fuel, misc.
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
