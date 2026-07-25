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
            Society, KFDC, Private and Local. Upload the bill, enter the total,
            posts to the boat/seller ledger.
          </div>
        </Link>
        <Link
          href="/vouchers/sales"
          className="block px-4 py-3 hover:bg-background border-b border-line"
        >
          <div className="font-semibold text-[14px]">Sale</div>
          <div className="text-muted text-[12px]">
            Market, Fish Mill, Factory or Local. Posts the sale to the buyer
            (or CareOf) ledger.
          </div>
        </Link>
        <Link
          href="/vouchers/deliveries"
          className="block px-4 py-3 hover:bg-background border-b border-line"
        >
          <div className="font-semibold text-[14px]">Delivery Note</div>
          <div className="text-muted text-[12px]">
            Dispatch record only — bill no, vehicle, driver and item table. No
            ledger or settlement.
          </div>
        </Link>
        <Link
          href="/vouchers/expenses"
          className="block px-4 py-3 hover:bg-background border-b border-line"
        >
          <div className="font-semibold text-[14px]">Expense</div>
          <div className="text-muted text-[12px]">
            Ice, loaders, ladies, batha, canteen, rent.
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
