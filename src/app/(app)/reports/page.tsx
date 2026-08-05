import Link from "next/link";
import { requireReports } from "@/lib/session";

const ITEMS = [
  {
    href: "/reports/register",
    label: "Transactions Report",
    desc: "Day, month or year. A day lists every transaction; a month totals each day; a year totals each month — with purchase, sale, expense and P/L throughout.",
  },
  {
    href: "/reports/profit",
    label: "Profit breakdown",
    desc: "Sale − (Purchase + Expense) for any date range, split by type and category.",
  },
  {
    href: "/ledgers/parties",
    label: "Party Statements",
    desc: "Per-centre statement for any purchase party, buyer, vendor or CareOf agent — exportable as CSV.",
  },
];

export default async function ReportsPage() {
  await requireReports();

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
