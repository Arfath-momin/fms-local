import Link from "next/link";

const ITEMS = [
  {
    href: "/ledgers/day-book",
    label: "Day Book",
    desc: "The daily row — Purchase, Expenses, Sale, P/F — with per-type breakdowns.",
  },
  {
    href: "/ledgers/parties",
    label: "Party Ledgers",
    desc: "Statement and outstanding balance for every boat, seller, buyer and vendor.",
  },
  {
    href: "/ledgers/expenses",
    label: "Expense Ledgers",
    desc: "One mini ledger per category — ice, loaders, ladies, batha, canteen, rent.",
  },
];

export default function LedgersPage() {
  return (
    <div>
      <h1 className="heading text-xl font-semibold mb-4">Ledgers</h1>
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
