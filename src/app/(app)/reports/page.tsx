import Link from "next/link";

const ITEMS = [
  {
    href: "/reports/pnl",
    label: "Profit & Loss",
    desc: "Day, month, year or custom range — accrual figures with the 90-day aged-outstanding rule.",
  },
  {
    href: "/reports/balance-sheet",
    label: "Balance Sheet",
    desc: "Stock at cost, receivables, owner reserve and payables as of any date.",
  },
  {
    href: "/reports/stock",
    label: "Stock Reconciliation",
    desc: "Available / In Transit / Sold / Loss per fish type — always sums to total purchased.",
  },
  {
    href: "/ledgers/parties",
    label: "Party Statements",
    desc: "Full statement per party, exportable as CSV.",
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
