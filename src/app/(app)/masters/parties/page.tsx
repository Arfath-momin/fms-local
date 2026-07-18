import Link from "next/link";
import type { PartyType } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/session";
import {
  PARTY_TYPES,
  PARTY_TYPE_LABELS,
  PARTY_TYPE_PLURALS,
} from "@/lib/party";

export default async function PartiesPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string }>;
}) {
  const session = await requireSession();
  const isMerchant = session.role === "MERCHANT";

  const rawType = (await searchParams).type as PartyType | undefined;
  const type = rawType && PARTY_TYPES.includes(rawType) ? rawType : null;

  const parties = await prisma.party.findMany({
    where: type ? { type } : undefined,
    orderBy: { name: "asc" },
  });

  const title = type ? PARTY_TYPE_PLURALS[type] : "All Parties";
  const newHref = type
    ? `/masters/parties/new?type=${type}`
    : "/masters/parties/new";

  return (
    <div>
      <Link
        href="/masters"
        className="text-muted text-[12px] underline underline-offset-2"
      >
        ← Masters
      </Link>
      <div className="flex items-end justify-between mt-1 mb-4">
        <div>
          <h1 className="heading text-xl font-semibold">{title}</h1>
          <p className="text-muted text-[13px]">
            Shared master across BFM and B2B. Balances are per company, on
            each party&apos;s ledger.
          </p>
        </div>
        {isMerchant && (
          <Link
            href={newHref}
            className="bg-accent text-white px-4 py-2 text-[13px] font-semibold"
          >
            New {type ? PARTY_TYPE_LABELS[type] : "Party"}
          </Link>
        )}
      </div>

      {parties.length === 0 ? (
        <p className="text-[13px] text-muted border border-line bg-surface px-4 py-3 max-w-lg">
          No {type ? PARTY_TYPE_LABELS[type].toLowerCase() : "party"} entries
          yet.
          {isMerchant &&
            ` Use “New ${type ? PARTY_TYPE_LABELS[type] : "Party"}” to add the first one.`}
        </p>
      ) : (
        <div className="border border-line-strong bg-surface max-w-2xl">
          <table className="ledger-table">
            <thead>
              <tr>
                <th>Name</th>
                {!type && <th>Type</th>}
                <th>Contact</th>
                {isMerchant && <th className="w-16"></th>}
              </tr>
            </thead>
            <tbody>
              {parties.map((p) => (
                <tr key={p.id}>
                  <td className="font-medium">{p.name}</td>
                  {!type && <td>{PARTY_TYPE_LABELS[p.type]}</td>}
                  <td className="text-muted">{p.contactInfo ?? "—"}</td>
                  {isMerchant && (
                    <td>
                      <Link
                        href={`/masters/parties/${p.id}`}
                        className="text-accent underline underline-offset-2 text-[12px]"
                      >
                        Edit
                      </Link>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
