import Link from "next/link";
import { Prisma } from "@/generated/prisma/client";
import { requireReports } from "@/lib/session";
import { getActiveScope } from "@/lib/centre";
import { computeDayBook } from "@/lib/report";
import { NoCentreNotice } from "../../no-centre";
import { PURCHASE_TYPE_LABELS } from "@/lib/purchase";
import { SALE_TYPE_LABELS } from "@/lib/sale";
import { businessToday, businessTodayDate, fmtDate, fmtMoney, toInputDate } from "@/lib/format";
import { DateField } from "../../date-field";

const ZERO = new Prisma.Decimal(0);

export default async function DayBookPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  await requireReports();
  const { company, centre } = await getActiveScope();
  if (!centre) return <NoCentreNotice companyName={company.name} />;

  const raw = (await searchParams).date;
  const date =
    raw && /^\d{4}-\d{2}-\d{2}$/.test(raw)
      ? new Date(raw)
      : businessTodayDate();

  const d = await computeDayBook(company.id, centre.id, date);

  /**
   * Whether the day has any vouchers at all.
   *
   * Read off the breakdowns, not the totals: they come from a groupBy, so an
   * empty array means nothing was recorded, while a zero total can equally
   * mean a sale that exactly covered its costs. The two are different answers
   * and must not print the same.
   */
  const noVouchers =
    d.purchaseByType.length === 0 &&
    d.expenseByCategory.length === 0 &&
    d.saleByType.length === 0;
  const isToday = toInputDate(date) === businessToday();
  const pfCls = d.grossProfit.greaterThan(0)
    ? "text-credit"
    : d.grossProfit.lessThan(0)
      ? "text-debit"
      : "";

  return (
    <div className="max-w-3xl">
      <div className="flex items-end justify-between flex-wrap gap-3 mb-4">
        <div>
          <h1 className="heading text-xl font-semibold">Day Book</h1>
          <p className="text-muted text-[13px]">
            {company.name} · {centre.name}
          </p>
        </div>
        <form method="GET" className="flex items-center gap-2">
          <label
            htmlFor="date"
            className="text-[12px] uppercase tracking-wide text-muted font-semibold"
          >
            Date
          </label>
          <DateField
            id="date"
            name="date"
            
            defaultValue={toInputDate(date)}
            className="border border-line-strong bg-surface px-3 py-1.5 text-sm outline-none focus:border-accent"
          />
          <button
            type="submit"
            className="bg-accent text-white px-3 py-1.5 text-[13px] font-semibold"
          >
            Show
          </button>
        </form>
      </div>

      {/*
        A day with nothing on it, said in words.
        Four ₹0.00 figures and three em-dashes are what this screen showed for
        an empty day, which reads as a broken page rather than as an answer —
        and most often it is simply today, opened a few hours after the date
        rolled over in India while the last entries are still yesterday's.
      */}
      {noVouchers ? (
        <p className="text-[13px] text-muted border border-line bg-surface px-4 py-3 max-w-lg">
          No purchases, sales or expenses recorded for {company.name} ·{" "}
          {centre.name} on {fmtDate(date)}.
          {isToday &&
            " The Day Book opens on today's date in India, which rolls over at" +
              " midnight IST — pick an earlier date above to see the last day" +
              " traded."}
        </p>
      ) : (
      <>
      {/* The daily row: Sale − (Purchase + Expense) = Profit */}
      <div className="border border-line-strong bg-surface overflow-x-auto">
        <table className="ledger-table">
          <thead>
            <tr>
              <th className="num-col">
                <Link href="/vouchers/purchases" className="hover:underline">
                  Purchase
                </Link>
              </th>
              <th className="num-col">
                <Link href="/ledgers/expenses" className="hover:underline">
                  Expenses
                </Link>
              </th>
              <th className="num-col">
                <Link href="/vouchers/sales" className="hover:underline">
                  Sale
                </Link>
              </th>
              <th className="num-col">P/F</th>
            </tr>
          </thead>
          <tbody>
            <tr className="text-[15px]">
              <td className="num-col num font-semibold text-debit">
                {fmtMoney(d.purchase)}
              </td>
              <td className="num-col num font-semibold text-debit">
                {fmtMoney(d.expense)}
              </td>
              <td className="num-col num font-semibold text-credit">
                {fmtMoney(d.sale)}
              </td>
              <td className={`num-col num font-bold ${pfCls}`}>
                {fmtMoney(d.grossProfit)}
              </td>
            </tr>
          </tbody>
        </table>
        <p className="px-4 py-2 text-[12px] text-muted border-t border-line">
          Profit = Sale − (Purchase + Expense), from the bills entered for this
          day.
        </p>
      </div>

      {/* Breakdowns */}
      <div className="grid sm:grid-cols-3 gap-3 mt-4">
        <Breakdown
          title="Purchase by type"
          rows={d.purchaseByType.map((r) => ({
            label: PURCHASE_TYPE_LABELS[r.type],
            amount: r.amount,
          }))}
          total={d.purchase}
        />
        <Breakdown
          title="Expense by category"
          rows={d.expenseByCategory.map((r) => ({
            label: r.name,
            amount: r.amount,
          }))}
          total={d.expense}
        />
        <Breakdown
          title="Sale by type"
          rows={d.saleByType.map((r) => ({
            label: SALE_TYPE_LABELS[r.type],
            amount: r.amount,
          }))}
          total={d.sale}
        />
      </div>
      </>
      )}
    </div>
  );
}

function Breakdown({
  title,
  rows,
  total,
}: {
  title: string;
  rows: { label: string; amount: Prisma.Decimal }[];
  total: Prisma.Decimal;
}) {
  return (
    <div className="border border-line bg-surface px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-muted font-semibold mb-1">
        {title}
      </div>
      {rows.length === 0 ? (
        <div className="text-muted text-[12px]">—</div>
      ) : (
        <table className="w-full text-[13px]">
          <tbody>
            {rows.map((r) => (
              <tr key={r.label}>
                <td className="py-0.5">{r.label}</td>
                <td className="py-0.5 num text-right">{fmtMoney(r.amount)}</td>
              </tr>
            ))}
            <tr className="border-t border-line font-semibold">
              <td className="py-0.5">Total</td>
              <td className="py-0.5 num text-right">{fmtMoney(total ?? ZERO)}</td>
            </tr>
          </tbody>
        </table>
      )}
    </div>
  );
}
