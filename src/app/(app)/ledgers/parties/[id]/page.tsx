import Link from "next/link";
import { notFound } from "next/navigation";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { getActiveScope } from "@/lib/centre";
import { PARTY_TYPE_LABELS } from "@/lib/party";
import { fmtDate, fmtMoney } from "@/lib/format";
import { NoCentreNotice } from "../../../no-centre";

const SOURCE_LABELS = {
  PURCHASE: "Purchase",
  SALE: "Sale",
  EXPENSE: "Expense",
  PAYMENT: "Payment",
};

export default async function PartyStatementPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireSession();
  const { company, centre } = await getActiveScope();
  if (!centre) return <NoCentreNotice companyName={company.name} />;
  const { id } = await params;

  const party = await prisma.party.findUnique({ where: { id } });
  if (!party) notFound();

  const entries = await prisma.ledgerEntry.findMany({
    where: { companyId: company.id, centreId: centre.id, partyId: id },
    orderBy: [{ date: "asc" }, { createdAt: "asc" }],
  });

  // Resolve source links for drill-down: each ledger entry's sourceId points at
  // its own voucher page (purchase / sale / expense). PAYMENT entries share the
  // source voucher's id, so they resolve to the same page.
  const sourceIds = [...new Set(entries.map((e) => e.sourceId))];
  const [sales, purchases, expenses] = await Promise.all([
    prisma.sale.findMany({
      where: { id: { in: sourceIds } },
      select: { id: true },
    }),
    prisma.purchase.findMany({
      where: { id: { in: sourceIds } },
      select: { id: true },
    }),
    prisma.expense.findMany({
      where: { id: { in: sourceIds } },
      select: { id: true },
    }),
  ]);
  const links = new Map<string, string>();
  for (const p of purchases) links.set(p.id, `/vouchers/purchases/${p.id}`);
  for (const e of expenses) links.set(e.id, `/vouchers/expenses/${e.id}`);
  for (const s of sales) links.set(s.id, `/vouchers/sales/${s.id}`);

  const balance =
    entries.at(-1)?.runningBalance ?? new Prisma.Decimal(0);

  return (
    <div className="max-w-3xl">
      <Link
        href="/ledgers/parties"
        className="text-muted text-[12px] underline underline-offset-2"
      >
        ← Party Ledgers
      </Link>
      <div className="flex items-end justify-between mt-1 mb-4">
        <div>
          <h1 className="heading text-xl font-semibold">{party.name}</h1>
          <p className="text-muted text-[13px]">
            {PARTY_TYPE_LABELS[party.type]} · statement for {company.name} ·{" "}
            {centre.name}
          </p>
          <a
            href={`/ledgers/parties/${party.id}/export`}
            className="inline-block mt-1 text-accent text-[12px] underline underline-offset-2"
          >
            Export statement (CSV)
          </a>
        </div>
        <div className="text-right">
          <div className="text-[12px] uppercase tracking-wide text-muted font-semibold">
            Outstanding Balance
          </div>
          <div
            className={`num text-xl font-bold ${
              balance.greaterThan(0)
                ? "text-debit"
                : balance.lessThan(0)
                  ? "text-credit"
                  : ""
            }`}
          >
            {fmtMoney(balance)}
          </div>
          {balance.greaterThan(0) && (
            <div className="text-debit text-[12px]">owes us</div>
          )}
          {balance.lessThan(0) && (
            <div className="text-credit text-[12px]">we owe them</div>
          )}
        </div>
      </div>

      {entries.length === 0 ? (
        <p className="text-[13px] text-muted border border-line bg-surface px-4 py-3 max-w-lg">
          No transactions with {party.name} in {company.name} yet.
        </p>
      ) : (
        <div className="border border-line-strong bg-surface">
          <table className="ledger-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Particulars</th>
                <th className="num-col">Debit</th>
                <th className="num-col">Credit</th>
                <th className="num-col">Balance</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => {
                const href = links.get(e.sourceId);
                const label = SOURCE_LABELS[e.sourceType];
                return (
                  <tr key={e.id}>
                    <td className="whitespace-nowrap">{fmtDate(e.date)}</td>
                    <td>
                      {href ? (
                        <Link
                          href={href}
                          className="text-accent underline underline-offset-2"
                        >
                          {label}
                        </Link>
                      ) : (
                        label
                      )}
                    </td>
                    <td className="num-col num text-debit">
                      {e.type === "DEBIT" ? fmtMoney(e.amount) : ""}
                    </td>
                    <td className="num-col num text-credit">
                      {e.type === "CREDIT" ? fmtMoney(e.amount) : ""}
                    </td>
                    <td className="num-col num font-semibold">
                      {fmtMoney(e.runningBalance)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
