import Link from "next/link";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { getActiveCompany } from "@/lib/company";
import { PARTY_TYPE_LABELS } from "@/lib/party";
import { fmtMoney } from "@/lib/format";

export default async function PartyLedgersPage() {
  await requireSession();
  const company = await getActiveCompany();

  const [parties, latestEntries] = await Promise.all([
    prisma.party.findMany({ orderBy: { name: "asc" } }),
    // Latest entry per party = current balance (distinct picks the first row
    // per party in this ordering).
    prisma.ledgerEntry.findMany({
      where: { companyId: company.id },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      distinct: ["partyId"],
      select: { partyId: true, runningBalance: true },
    }),
  ]);
  const balances = new Map(
    latestEntries.map((e) => [e.partyId, e.runningBalance])
  );
  const ZERO = new Prisma.Decimal(0);

  return (
    <div className="max-w-2xl">
      <h1 className="heading text-xl font-semibold mb-1">Party Ledgers</h1>
      <p className="text-muted text-[13px] mb-4">
        {company.name} · positive balance = party owes us.
      </p>

      <div className="border border-line-strong bg-surface">
        <table className="ledger-table">
          <thead>
            <tr>
              <th>Party</th>
              <th>Type</th>
              <th className="num-col">Balance</th>
            </tr>
          </thead>
          <tbody>
            {parties.map((p) => {
              const bal = balances.get(p.id) ?? ZERO;
              return (
                <tr key={p.id}>
                  <td className="font-medium">
                    <Link
                      href={`/ledgers/parties/${p.id}`}
                      className="text-accent underline underline-offset-2"
                    >
                      {p.name}
                    </Link>
                  </td>
                  <td>{PARTY_TYPE_LABELS[p.type]}</td>
                  <td
                    className={`num-col num font-semibold ${
                      bal.greaterThan(0)
                        ? "text-debit"
                        : bal.lessThan(0)
                          ? "text-credit"
                          : ""
                    }`}
                  >
                    {fmtMoney(bal)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
