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
            posts to the purchase party&rsquo;s ledger.
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
          href="/vouchers/payments"
          className="block px-4 py-3 hover:bg-background border-b border-line"
        >
          <div className="font-semibold text-[14px]">Payment</div>
          <div className="text-muted text-[12px]">
            Money paid out to a purchase party or vendor — settles what we owe
            them. Kept separate from the purchase it pays for.
          </div>
        </Link>
        <Link
          href="/vouchers/receipts"
          className="block px-4 py-3 hover:bg-background border-b border-line"
        >
          <div className="font-semibold text-[14px]">Receipt</div>
          <div className="text-muted text-[12px]">
            Money collected from a buyer — settles what they owe us. Kept
            separate from the sale it pays for.
          </div>
        </Link>
        <Link
          href="/vouchers/deliveries"
          className="block px-4 py-3 hover:bg-background border-b border-line"
        >
          <div className="font-semibold text-[14px]">Delivery Note</div>
          <div className="text-muted text-[12px]">
            The trip: one truck, one buying day, one channel. Its rent is
            charged to that day once and credited to the transporter.
          </div>
        </Link>
        <Link
          href="/vouchers/reserve-collections/new"
          className="block px-4 py-3 hover:bg-background border-b border-line"
        >
          <div className="font-semibold text-[14px]">Collect Reserve</div>
          <div className="text-muted text-[12px]">
            Money a market party withheld and is now paying back. Clears what
            they hold; recognised as income on the day it arrived.
          </div>
        </Link>
        <Link
          href="/vouchers/expenses"
          className="block px-4 py-3 hover:bg-background border-b border-line"
        >
          <div className="font-semibold text-[14px]">Expense</div>
          <div className="text-muted text-[12px]">
            Ice, loaders, ladies, batha, canteen and overheads. Vehicle
            rent is not here — it comes off the trip.
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
