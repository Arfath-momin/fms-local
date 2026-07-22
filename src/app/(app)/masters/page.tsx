import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { PARTY_TYPES, PARTY_TYPE_PLURALS } from "@/lib/party";

const TYPE_DESCRIPTIONS: Record<string, string> = {
  BOAT: "Boats — Society / KFDC / Private purchases are tracked per boat.",
  LOCAL_SELLER: "Local purchase sellers.",
  MARKET_BUYER: "Market buyers.",
  FACTORY: "Factories buying by delivery note.",
  FISH_MILL: "Fish mills buying by delivery note.",
  LOCAL_BUYER: "Local buyers.",
  EXPENSE_VENDOR: "Ice plants, landlords and other expense vendors.",
};

export default async function MastersPage() {
  await requireSession();

  const counts = await prisma.party.groupBy({
    by: ["type"],
    _count: true,
  });
  const countByType = new Map(counts.map((c) => [c.type, c._count]));

  return (
    <div>
      <h1 className="heading text-xl font-semibold mb-1">Masters</h1>
      <p className="text-muted text-[13px] mb-4">
        Parties are shared across BFM and B2B; balances stay per company.
      </p>
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
