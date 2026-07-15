import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { PARTY_TYPE_LABELS } from "@/lib/party";

export default async function PartiesPage() {
  const session = await requireSession();
  const isMerchant = session.role === "MERCHANT";
  const parties = await prisma.party.findMany({ orderBy: { name: "asc" } });

  return (
    <div>
      <div className="flex items-end justify-between mb-4">
        <div>
          <h1 className="heading text-xl font-semibold">Parties</h1>
          <p className="text-muted text-[13px]">
            Shared master across BFM and B2B. Balances are per company, on each
            party&apos;s ledger.
          </p>
        </div>
        {isMerchant && (
          <Link
            href="/masters/parties/new"
            className="bg-accent text-white px-4 py-2 text-[13px] font-semibold"
          >
            New Party
          </Link>
        )}
      </div>

      {parties.length === 0 ? (
        <p className="text-[13px] text-muted border border-line bg-surface px-4 py-3 max-w-lg">
          No parties yet.
          {isMerchant && " Use “New Party” to add the first one."}
        </p>
      ) : (
        <div className="border border-line-strong bg-surface">
          <table className="ledger-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Contact</th>
                {isMerchant && <th className="w-16"></th>}
              </tr>
            </thead>
            <tbody>
              {parties.map((p) => (
                <tr key={p.id}>
                  <td className="font-medium">{p.name}</td>
                  <td>{PARTY_TYPE_LABELS[p.type]}</td>
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
