import Link from "next/link";

const ITEMS = [
  {
    href: "/reports/register",
    label: "Daily Transactions",
    desc: "Every purchase, sale and expense across all centres for a day, month or year — with company-wide P/L below.",
  },
  {
    href: "/reports/profit",
    label: "Profit breakdown",
    desc: "Sale − (Purchase + Expense) for any date range, split by type and category.",
  },
  {
    href: "/ledgers/parties",
    label: "Party Statements",
    desc: "Per-centre statement for any boat, seller, buyer, vendor or CareOf agent — exportable as CSV.",
  },
];

export default function ReportsPage() {
  return (
    <div>
      <h1 className="heading text-xl font-semibold mb-4">Reports</h1>
      <div className="max-w-md border border-line bg-surface">
        {ITEMS.map((i) => (
          <Link
            key={i.href}
            href={i.href}
            className="block px-4 py-3 hover:bg-background border-b border-line last:border-b-0"
          >
            <div className="font-semibold text-[14px]">{i.label}</div>
            <div className="text-muted text-[12px]">{i.desc}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
