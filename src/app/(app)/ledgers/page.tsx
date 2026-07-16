import Link from "next/link";

const ITEMS = [
  {
    href: "/ledgers/day-book",
    label: "Day Book",
    desc: "The daily row — purchase, expenses, rent, sale, P/F — plus the COGS-matched true profit.",
  },
  {
    href: "/ledgers/parties",
    label: "Party Ledgers",
    desc: "Statement and outstanding balance for every party.",
  },
  {
    href: "/ledgers/expenses",
    label: "Expense Ledgers",
    desc: "One mini ledger per category — loaders, ice, rent, fuel and the rest.",
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
            className="block px-4 py-3 hover:bg-background border-b border-line"
          >
            <div className="font-semibold text-[14px]">{i.label}</div>
            <div className="text-muted text-[12px]">{i.desc}</div>
          </Link>
        ))}
        <Link
          href="/ledgers/owner-reserve"
          className="block px-4 py-3 hover:bg-background"
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
      </div>
    </div>
  );
}
