import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { PARTY_TYPES, PARTY_TYPE_PLURALS } from "@/lib/party";

const TYPE_DESCRIPTIONS: Record<string, string> = {
  BOAT: "Boat names for the rows of a Society / KFDC bill. A name list only — no ledger.",
  MARKET_BUYER: "Market buyers.",
  FACTORY: "Factories buying by delivery note.",
  FISH_MILL: "Fish mills buying by delivery note.",
  LOCAL_BUYER: "Local buyers.",
  EXPENSE_VENDOR: "Ice plants, landlords and other expense vendors.",
  CARE_OF: "Agents who pay immediately; Fish Mill/Factory sales can post to a CareOf ledger.",
  PURCHASE_GROUP:
    "Who purchases are owed to — Society, KFDC, and every private and local seller individually.",
  TRANSPORTER:
    "Who the trucks belong to. Each trip's rent is credited here and settled by the advance and by whatever a market party paid the driver.",
};

export default async function MastersPage() {
  await requireSession();

  // Live parties only, matching what the list behind each link actually shows.
  const counts = await prisma.party.groupBy({
    by: ["type"],
    where: { archivedAt: null },
    _count: true,
  });
  const countByType = new Map(counts.map((c) => [c.type, c._count]));

  return (
    <div>
      <h1 className="heading text-xl font-semibold mb-1">Masters</h1>
      <p className="text-muted text-[13px] mb-4">
        Centres are per company; parties are shared across companies with
        balances kept per centre.
      </p>

      <div className="max-w-md border border-line bg-surface mb-4">
        <Link
          href="/masters/centres"
          className="block px-4 py-3 hover:bg-background border-b border-line"
        >
          <div className="font-semibold text-[14px]">Centres</div>
          <div className="text-muted text-[12px]">
            Isolated transaction/ledger scopes inside the active company.
          </div>
        </Link>
        {/* Company-scoped like centres, not shared like parties: BFM and B2B
            may use the same truck, but each keeps its own row. */}
        <Link
          href="/masters/vehicles"
          className="block px-4 py-3 hover:bg-background border-b border-line"
        >
          <div className="font-semibold text-[14px]">Vehicles</div>
          <div className="text-muted text-[12px]">
            The trucks trips go out on, and who each one belongs to.
          </div>
        </Link>
        <Link
          href="/masters/expense-categories"
          className="block px-4 py-3 hover:bg-background"
        >
          <div className="font-semibold text-[14px]">Expense Categories</div>
          <div className="text-muted text-[12px]">
            What a cost is called, and whether it belongs to the buying day or
            to the month.
          </div>
        </Link>
      </div>

      <div className="max-w-md border border-line bg-surface">
        {PARTY_TYPES.map((t) => (
          <Link
            key={t}
            href={`/masters/parties?type=${t}`}
            className="flex items-center justify-between px-4 py-3 hover:bg-background border-b border-line"
          >
            <div>
              <div className="font-semibold text-[14px]">
                {PARTY_TYPE_PLURALS[t]}
              </div>
              <div className="text-muted text-[12px]">
                {TYPE_DESCRIPTIONS[t]}
              </div>
            </div>
            <span className="num text-[13px] text-muted">
              {countByType.get(t) ?? 0}
            </span>
          </Link>
        ))}
        <Link
          href="/masters/parties"
          className="block px-4 py-3 hover:bg-background"
        >
          <div className="font-semibold text-[14px]">All Parties</div>
          <div className="text-muted text-[12px]">
            Every party of every type in one list.
          </div>
        </Link>
      </div>
    </div>
  );
}
