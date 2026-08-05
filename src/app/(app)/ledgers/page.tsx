import Link from "next/link";
import { canViewReports, requireSession } from "@/lib/session";

// One entry per question the merchant actually asks. The old menu offered a
// single "Party Ledgers" list holding every boat, seller, buyer and vendor
// alphabetically, which meant finding Society took as long as finding a
// one-off buyer. Splitting by what the party *is* makes each list short enough
// to read at a glance.
//
// `analytics: true` marks a screen that reports P/L rather than balances, so
// it follows the Reports permission instead of the Ledgers one.
const ITEMS = [
  {
    href: "/ledgers/day-book",
    label: "Day Book",
    desc: "The daily row — Purchase, Expenses, Sale, P/F — with per-type breakdowns.",
    analytics: true,
  },
  {
    href: "/ledgers/purchase-parties",
    label: "Purchase Parties",
    desc: "Who we buy from and what is still owed — Society, KFDC, private parties, Local Individuals. Boats show inside, on the line.",
  },
  {
    href: "/ledgers/expenses",
    label: "Expenses",
    desc: "Every expense ledger — by category, and by vendor.",
  },
  {
    href: "/ledgers/sales",
    label: "Sales",
    desc: "Every buyer and what they owe us, grouped by sale category.",
  },
  {
    href: "/ledgers/commission",
    label: "Commission",
    desc: "The 2% earned on every Market sale, with a running balance.",
  },
];

export default async function LedgersPage() {
  const { role } = await requireSession();
  const items = ITEMS.filter((i) => !i.analytics || canViewReports(role));

  return (
    <div>
      <h1 className="heading text-xl font-semibold mb-4">Ledgers</h1>
      <div className="max-w-md border border-line bg-surface">
        {items.map((i) => (
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
      <p className="text-muted text-[12px] mt-3 max-w-md">
        Looking for one name across all of them?{" "}
        <Link
          href="/ledgers/parties"
          className="text-accent underline underline-offset-2"
        >
          All ledgers in one list
        </Link>
        .
      </p>
    </div>
  );
}
