import Link from "next/link";
import { Prisma } from "@/generated/prisma/client";
import { requireSession } from "@/lib/session";
import { getActiveScope } from "@/lib/centre";
import { isDayClosed } from "@/lib/dayclose";
import { computeDayBook } from "@/lib/report";
import { NoCentreNotice } from "../../no-centre";
import { EXPENSE_CATEGORY_LABELS } from "@/lib/expense";
import { PURCHASE_TYPE_LABELS } from "@/lib/purchase";
import { SALE_TYPE_LABELS } from "@/lib/sale";
import { fmtDate, fmtMoney, toInputDate } from "@/lib/format";
import { closeDay } from "./actions";

const ZERO = new Prisma.Decimal(0);

export default async function DayBookPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const session = await requireSession();
  const { company, centre } = await getActiveScope();
  if (!centre) return <NoCentreNotice companyName={company.name} />;

  const raw = (await searchParams).date;
  const date =
    raw && /^\d{4}-\d{2}-\d{2}$/.test(raw)
      ? new Date(raw)
      : new Date(toInputDate(new Date()));

  const [d, closed] = await Promise.all([
    computeDayBook(company.id, date),
    isDayClosed(company.id, centre.id, date),
  ]);
  const isMerchant = session.role === "MERCHANT";
  const isFuture = date.getTime() > new Date(toInputDate(new Date())).getTime();
  const pfCls = d.profit.greaterThan(0)
    ? "text-credit"
    : d.profit.lessThan(0)
      ? "text-debit"
      : "";

  return (
    <div className="max-w-3xl">
      <div className="flex items-end justify-between mb-4">
        <div>
          <h1 className="heading text-xl font-semibold">Day Book</h1>
          <p className="text-muted text-[13px]">
            {company.name} · company-wide P/L · Close Day locks {centre.name}
          </p>
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

      {/* The daily row: Sale − (Purchase + Expense) = Profit */}
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
                {fmtMoney(d.profit)}
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
            label: EXPENSE_CATEGORY_LABELS[r.category],
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
