import Link from "next/link";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { getActiveCompany } from "@/lib/company";
import { getStockSummary } from "@/lib/stock";
import { computeDayBook, getAvgCostMap, getBalancesAsOf } from "@/lib/report";
import { CHANNEL_LABELS, PENDING_WARN_DAYS } from "@/lib/delivery";
import { fmtDate, fmtKg, fmtMoney, toInputDate } from "@/lib/format";
import { StatusBadge, daysSince } from "../vouchers/deliveries/status-badge";

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
  await requireSession();
  const company = await getActiveCompany();
  const today = new Date(toInputDate(new Date()));

  const [day, stock, avgCost, balances, pendingNotes] = await Promise.all([
    computeDayBook(company.id, today),
    getStockSummary(company.id),
    getAvgCostMap(company.id, today),
    getBalancesAsOf(company.id, today),
    prisma.deliveryNote.findMany({
      where: { companyId: company.id, status: { not: "SETTLED" } },
      include: { party: { select: { name: true } } },
      orderBy: [{ date: "asc" }, { createdAt: "asc" }],
    }),
  ]);

  let stockKg = ZERO;
  let stockValue = ZERO;
  for (const r of stock) {
    if (!r.available.greaterThan(0)) continue;
    stockKg = stockKg.add(r.available);
    stockValue = stockValue.add(r.available.mul(avgCost.get(r.fishType) ?? ZERO));
  }

  let outstanding = ZERO;
  let owingParties = 0;
  for (const bal of balances.values()) {
    if (bal.greaterThan(0)) {
      outstanding = outstanding.add(bal);
      owingParties += 1;
    }
  }

  const overdue = pendingNotes.filter(
    (n) => daysSince(n.date) >= PENDING_WARN_DAYS
  );
  const pfCls = day.cashPf.greaterThan(0)
    ? "text-credit"
    : day.cashPf.lessThan(0)
      ? "text-debit"
      : "";

  return (
    <div className="max-w-4xl">
      <h1 className="heading text-xl font-semibold mb-1">Dashboard</h1>
      <p className="text-muted text-[13px] mb-5">
        {company.name} · today, {fmtDate(today)}. Every figure clicks through
        to its underlying entries.
      </p>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <Tile
          href="/vouchers/purchases"
          label="Purchase today"
          value={fmtMoney(day.purchase)}
          valueCls="text-debit"
        />
        <Tile
          href="/vouchers/deliveries"
          label="Sale today (received)"
          value={fmtMoney(day.cashSale)}
          valueCls="text-credit"
        />
        <Tile
          href="/ledgers/expenses"
          label="Expenses today (incl. rent)"
          value={fmtMoney(day.expenses.add(day.rent))}
          valueCls="text-debit"
        />
        <Tile
          href="/ledgers/day-book"
          label="P/F today (cash)"
          value={fmtMoney(day.cashPf)}
          sub={`true profit ${fmtMoney(day.truePf)} — see Day Book`}
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
        <Tile
          href="/reports/stock"
          label="Stock available"
          value={fmtKg(stockKg)}
          sub={`${fmtMoney(stockValue)} at cost`}
        />
      </div>

      <div className="mt-6">
        <h2 className="heading text-[15px] font-semibold mb-2">
          Pending settlements
        </h2>
        {pendingNotes.length === 0 ? (
          <p className="text-muted text-[13px] border border-line bg-surface px-4 py-3 max-w-lg">
            No deliveries pending settlement.
          </p>
        ) : (
          <div className="border border-line-strong bg-surface">
            <table className="ledger-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Buyer</th>
                  <th>Channel</th>
                  <th>Fish</th>
                  <th className="num-col">Expected</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {pendingNotes.map((n) => {
                  const age = daysSince(n.date);
                  const late = age >= PENDING_WARN_DAYS;
                  return (
                    <tr key={n.id}>
                      <td className="whitespace-nowrap">
                        {fmtDate(n.date)}
                        {late && (
                          <span className="ml-2 text-debit text-[11px] font-semibold">
                            {age} days
                          </span>
                        )}
                      </td>
                      <td className="font-medium">{n.party.name}</td>
                      <td>{CHANNEL_LABELS[n.channel]}</td>
                      <td>{n.fishType}</td>
                      <td className="num-col num">
                        {fmtMoney(n.expectedValue)}
                      </td>
                      <td>
                        <StatusBadge status={n.status} />
                      </td>
                      <td>
                        <Link
                          href={`/vouchers/deliveries/${n.id}`}
                          className="text-accent underline underline-offset-2 text-[12px]"
                        >
                          Open
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {overdue.length > 0 && (
              <p className="px-4 py-2 text-[12px] text-debit border-t border-line font-semibold">
                {overdue.length}{" "}
                {overdue.length === 1 ? "delivery has" : "deliveries have"}{" "}
                been unsettled for {PENDING_WARN_DAYS}+ days.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
