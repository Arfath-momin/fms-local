import Link from "next/link";
import { Prisma } from "@/generated/prisma/client";
import { requireSession } from "@/lib/session";
import { getActiveCompany } from "@/lib/company";
import { isDayClosed } from "@/lib/dayclose";
import { computeDayBook } from "@/lib/report";
import { fmtDate, fmtMoney, toInputDate } from "@/lib/format";
import { closeDay } from "./actions";

export default async function DayBookPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const session = await requireSession();
  const company = await getActiveCompany();

  const raw = (await searchParams).date;
  const date =
    raw && /^\d{4}-\d{2}-\d{2}$/.test(raw)
      ? new Date(raw)
      : new Date(toInputDate(new Date()));

  const [d, closed] = await Promise.all([
    computeDayBook(company.id, date),
    isDayClosed(company.id, date),
  ]);
  const isMerchant = session.role === "MERCHANT";
  const isFuture = date.getTime() > new Date(toInputDate(new Date())).getTime();
  const pfCls = (v: Prisma.Decimal) =>
    v.greaterThan(0) ? "text-credit" : v.lessThan(0) ? "text-debit" : "";

  return (
    <div className="max-w-3xl">
      <div className="flex items-end justify-between mb-4">
        <div>
          <h1 className="heading text-xl font-semibold">Day Book</h1>
          <p className="text-muted text-[13px]">{company.name}</p>
        </div>
        <form method="GET" className="flex items-center gap-2">
          <label
            htmlFor="date"
            className="text-[12px] uppercase tracking-wide text-muted font-semibold"
          >
            Date
          </label>
          <input
            id="date"
            name="date"
            type="date"
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

      {closed ? (
        <div className="border border-line-strong bg-[#edece7] px-4 py-2.5 mb-3 flex items-center gap-2 text-[13px]">
          <span aria-hidden>🔒</span>
          <span className="font-semibold">
            This day is closed — entries are final.
          </span>
          <span className="text-muted">
            Corrections go through the error-flag flow on each voucher.
          </span>
        </div>
      ) : (
        isMerchant &&
        !isFuture && (
          <form action={closeDay} className="mb-3">
            <input type="hidden" name="date" value={toInputDate(date)} />
            <button
              type="submit"
              className="border border-line-strong bg-surface px-4 py-2 text-[13px] font-semibold hover:border-accent"
            >
              🔒 Close Day — lock all entries for {fmtDate(date)}
            </button>
          </form>
        )
      )}

      {/* The familiar daily row — cash snapshot, primary (design doc #7) */}
      <div className="border border-line-strong bg-surface">
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
                <Link href="/ledgers/expenses/rent" className="hover:underline">
                  Rent
                </Link>
              </th>
              <th className="num-col">Sale</th>
              <th className="num-col">P/F</th>
            </tr>
          </thead>
          <tbody>
            <tr className="text-[15px]">
              <td className="num-col num font-semibold text-debit">
                {fmtMoney(d.purchase)}
              </td>
              <td className="num-col num font-semibold text-debit">
                {fmtMoney(d.expenses)}
              </td>
              <td className="num-col num font-semibold text-debit">
                {fmtMoney(d.rent)}
              </td>
              <td className="num-col num font-semibold text-credit">
                {fmtMoney(d.cashSale)}
              </td>
              <td className={`num-col num font-bold ${pfCls(d.cashPf)}`}>
                {fmtMoney(d.cashPf)}
              </td>
            </tr>
          </tbody>
        </table>
        <p className="px-4 py-2 text-[12px] text-muted border-t border-line">
          Cash snapshot: money received today minus money spent today. Stock
          bought today but not yet sold makes this look worse than reality.
        </p>
      </div>

      {/* Secondary, visually distinct: the accrual-accurate figure */}
      <div className="border border-line bg-background mt-3 px-4 py-3">
        <div className="flex items-center justify-between">
          <span className="text-[13px] font-semibold">
            True profit (COGS-matched)
            <span className="text-muted font-normal">
              {" "}
              — value sold today minus what that stock cost, spoilage and the
              day&apos;s expenses
            </span>
          </span>
          <span className={`num text-lg font-bold ${pfCls(d.truePf)}`}>
            {fmtMoney(d.truePf)}
          </span>
        </div>
        <div className="mt-2 text-[12px] text-muted num flex gap-5 flex-wrap">
          <span>Revenue earned {fmtMoney(d.accrualRevenue)}</span>
          <span>− cost of goods sold {fmtMoney(d.cogs)}</span>
          <span>− spoilage {fmtMoney(d.spoilage)}</span>
          <span>− expenses &amp; rent {fmtMoney(d.expenses.add(d.rent))}</span>
        </div>
      </div>
    </div>
  );
}
