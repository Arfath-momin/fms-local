import Link from "next/link";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { requireReports } from "@/lib/session";
import { getActiveScope } from "@/lib/centre";
import { computeDayBook, getBalancesAsOf } from "@/lib/report";
import { SALE_TYPE_LABELS } from "@/lib/sale";
import { businessTodayDate, fmtDate, fmtMoney } from "@/lib/format";
import { NoCentreNotice } from "../no-centre";

const ZERO = new Prisma.Decimal(0);

function Tile({
  href,
  label,
  value,
  sub,
  valueCls,
}: {
  href: string;
  label: string;
  value: string;
  sub?: string;
  valueCls?: string;
}) {
  return (
    <Link
      href={href}
      className="block border border-line-strong bg-surface px-4 py-3 hover:border-accent"
    >
      <div className="text-[11px] uppercase tracking-wide text-muted font-semibold">
        {label}
      </div>
      <div className={`num text-xl font-bold mt-1 ${valueCls ?? ""}`}>
        {value}
      </div>
      {sub && <div className="text-muted text-[12px] mt-0.5">{sub}</div>}
    </Link>
  );
}

export default async function DashboardPage() {
  await requireReports();
  const { company, centre } = await getActiveScope();
  if (!centre) return <NoCentreNotice companyName={company.name} />;
  const today = businessTodayDate();

  const [day, balances, recentSales] = await Promise.all([
    computeDayBook(company.id, centre.id, today),
    getBalancesAsOf(company.id, centre.id, today),
    prisma.sale.findMany({
      where: { companyId: company.id, centreId: centre.id },
      include: {
        party: { select: { name: true } },
        careOfParty: { select: { name: true } },
      },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      take: 8,
    }),
  ]);

  let outstanding = ZERO;
  let owingParties = 0;
  for (const bal of balances.values()) {
    if (bal.greaterThan(0)) {
      outstanding = outstanding.add(bal);
      owingParties += 1;
    }
  }

  const pfCls = day.profit.greaterThan(0)
    ? "text-credit"
    : day.profit.lessThan(0)
      ? "text-debit"
      : "";

  return (
    <div className="max-w-4xl">
      <h1 className="heading text-xl font-semibold mb-1">Dashboard</h1>
      <p className="text-muted text-[13px] mb-5">
        {company.name} · {centre.name} · today, {fmtDate(today)}. Every figure
        below is for this company and centre only — use Union for the
        cross-centre view.
      </p>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Tile
          href="/vouchers/purchases"
          label="Purchase today"
          value={fmtMoney(day.purchase)}
          valueCls="text-debit"
        />
        <Tile
          href="/ledgers/expenses"
          label="Expenses today"
          value={fmtMoney(day.expense)}
          valueCls="text-debit"
        />
        <Tile
          href="/vouchers/sales"
          label="Sale today"
          value={fmtMoney(day.sale)}
          valueCls="text-credit"
        />
        <Tile
          href="/ledgers/day-book"
          label="Profit today"
          value={fmtMoney(day.profit)}
          sub="Sale − (Purchase + Expense)"
          valueCls={pfCls}
        />
        <Tile
          href="/ledgers/parties"
          label="Outstanding"
          value={fmtMoney(outstanding)}
          sub={
            owingParties === 0
              ? "no parties owe us"
              : `${owingParties} ${owingParties === 1 ? "party owes" : "parties owe"} us`
          }
          valueCls={outstanding.greaterThan(0) ? "text-debit" : ""}
        />
      </div>

      <div className="mt-6">
        <h2 className="heading text-[15px] font-semibold mb-2">Recent sales</h2>
        {recentSales.length === 0 ? (
          <p className="text-muted text-[13px] border border-line bg-surface px-4 py-3 max-w-lg">
            No sales recorded in this centre yet.
          </p>
        ) : (
          <div className="border border-line-strong bg-surface">
            <table className="ledger-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Bill No.</th>
                  <th>Type</th>
                  <th>Party</th>
                  <th className="num-col">Amount</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {recentSales.map((s) => (
                  <tr key={s.id}>
                    <td className="whitespace-nowrap">{fmtDate(s.date)}</td>
                    <td className="num">{s.billNo}</td>
                    <td>{SALE_TYPE_LABELS[s.type]}</td>
                    <td className="font-medium">
                      {s.party.name}
                      {s.careOfParty && (
                        <span className="text-muted text-[12px]">
                          {" "}
                          · c/o {s.careOfParty.name}
                        </span>
                      )}
                    </td>
                    <td className="num-col num text-credit">
                      {fmtMoney(s.amount)}
                    </td>
                    <td>
                      <Link
                        href={`/vouchers/sales/${s.id}`}
                        className="text-accent underline underline-offset-2 text-[12px]"
                      >
                        Open
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
