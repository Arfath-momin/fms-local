import Link from "next/link";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { getActiveCompany } from "@/lib/company";
import { fmtDate, fmtMoney } from "@/lib/format";

export default async function OwnerReservePage() {
  await requireSession();
  const company = await getActiveCompany();

  const entries = await prisma.ownerReserveEntry.findMany({
    where: { companyId: company.id },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    include: {
      settlement: {
        include: {
          deliveryNote: {
            include: { party: { select: { name: true } } },
          },
        },
      },
    },
  });

  const balance = entries[0]?.runningBalance ?? new Prisma.Decimal(0);

  return (
    <div className="max-w-3xl">
      <div className="flex items-end justify-between mb-4">
        <div>
          <h1 className="heading text-xl font-semibold">
            Owner Reserve Account
          </h1>
          <p className="text-muted text-[13px]">
            {company.name} ·{" "}
            <span className="uppercase tracking-wide font-semibold">
              internal account
            </span>{" "}
            — amounts withheld on market bills, accumulating with the market
            owner. Not a party ledger.
          </p>
        </div>
        <div className="text-right">
          <div className="text-[12px] uppercase tracking-wide text-muted font-semibold">
            Balance
          </div>
          <div className="num text-xl font-bold text-credit">
            {fmtMoney(balance)}
          </div>
        </div>
      </div>

      {entries.length === 0 ? (
        <p className="text-[13px] text-muted border border-line bg-surface px-4 py-3 max-w-lg">
          No reserve entries for {company.name} yet. They appear when a market
          settlement is entered with an Owner Reserve amount.
        </p>
      ) : (
        <div className="border border-line-strong bg-surface">
          <table className="ledger-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>From Settlement</th>
                <th className="num-col">Amount</th>
                <th className="num-col">Running Balance</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id}>
                  <td className="whitespace-nowrap">{fmtDate(e.date)}</td>
                  <td>
                    <Link
                      href={`/vouchers/deliveries/${e.settlement.deliveryNoteId}`}
                      className="text-accent underline underline-offset-2"
                    >
                      {e.settlement.deliveryNote.party.name} ·{" "}
                      {e.settlement.deliveryNote.fishType}
                    </Link>
                  </td>
                  <td className="num-col num text-credit">
                    {fmtMoney(e.amount)}
                  </td>
                  <td className="num-col num font-semibold">
                    {fmtMoney(e.runningBalance)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
