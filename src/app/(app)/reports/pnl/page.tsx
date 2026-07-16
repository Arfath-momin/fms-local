import Link from "next/link";
import { requireSession } from "@/lib/session";
import { getActiveCompany } from "@/lib/company";
import { computePnL, AGED_LOSS_DAYS } from "@/lib/report";
import { EXPENSE_CATEGORY_LABELS } from "@/lib/expense";
import type { ExpenseCategory } from "@/generated/prisma/enums";
import { fmtDate, fmtMoney, toInputDate } from "@/lib/format";

function presetRange(preset: string | undefined, today: Date) {
  const y = today.getUTCFullYear();
  const m = today.getUTCMonth();
  switch (preset) {
    case "year":
      return { from: new Date(Date.UTC(y, 0, 1)), to: today };
    case "day":
      return { from: today, to: today };
    case "month":
    default:
      return { from: new Date(Date.UTC(y, m, 1)), to: today };
  }
}

export default async function PnLPage({
  searchParams,
}: {
  searchParams: Promise<{ preset?: string; from?: string; to?: string }>;
}) {
  await requireSession();
  const company = await getActiveCompany();
  const params = await searchParams;

  const today = new Date(toInputDate(new Date()));
  const valid = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(s) : null);
  const custom = { from: valid(params.from), to: valid(params.to) };
  const range =
    custom.from && custom.to
      ? { from: custom.from, to: custom.to }
      : presetRange(params.preset, today);

  const pnl = await computePnL(company.id, range.from, range.to);
  const netCls = pnl.netProfit.greaterThan(0)
    ? "text-credit"
    : pnl.netProfit.lessThan(0)
      ? "text-debit"
      : "";

  const row = (label: React.ReactNode, value: string, opts?: { bold?: boolean; cls?: string; indent?: boolean }) => (
    <tr>
      <td className={opts?.indent ? "pl-8" : ""}>{label}</td>
      <td className={`num-col num ${opts?.bold ? "font-bold" : ""} ${opts?.cls ?? ""}`}>
        {value}
      </td>
    </tr>
  );

  return (
    <div className="max-w-2xl">
      <div className="flex items-end justify-between mb-4">
        <div>
          <h1 className="heading text-xl font-semibold">Profit &amp; Loss</h1>
          <p className="text-muted text-[13px]">
            {company.name} · {fmtDate(range.from)} – {fmtDate(range.to)}
          </p>
        </div>
        <div className="flex gap-2 text-[12px]">
          {[
            { p: "day", label: "Today" },
            { p: "month", label: "This Month" },
            { p: "year", label: "This Year" },
          ].map((x) => (
            <Link
              key={x.p}
              href={`/reports/pnl?preset=${x.p}`}
              className="border border-line-strong px-3 py-1.5 hover:border-accent"
            >
              {x.label}
            </Link>
          ))}
        </div>
      </div>

      <form method="GET" className="flex items-center gap-2 mb-4 text-[13px]">
        <label htmlFor="from" className="text-muted text-[12px] uppercase tracking-wide font-semibold">
          From
        </label>
        <input
          id="from"
          name="from"
          type="date"
          defaultValue={toInputDate(range.from)}
          className="border border-line-strong bg-surface px-2 py-1.5 outline-none focus:border-accent"
        />
        <label htmlFor="to" className="text-muted text-[12px] uppercase tracking-wide font-semibold">
          To
        </label>
        <input
          id="to"
          name="to"
          type="date"
          defaultValue={toInputDate(range.to)}
          className="border border-line-strong bg-surface px-2 py-1.5 outline-none focus:border-accent"
        />
        <button type="submit" className="bg-accent text-white px-3 py-1.5 text-[13px] font-semibold">
          Show
        </button>
      </form>

      <div className="border border-line-strong bg-surface">
        <table className="ledger-table">
          <tbody>
            {row("Revenue (sales at locked rates + direct sales)", fmtMoney(pnl.revenue), { cls: "text-credit" })}
            {row("Cost of goods sold (weighted-average purchase cost)", fmtMoney(pnl.cogs.negated()), { cls: "text-debit" })}
            {row("Spoilage loss", fmtMoney(pnl.spoilage.negated()), { cls: "text-debit" })}
            {row(<span className="font-semibold">Gross profit</span>, fmtMoney(pnl.grossProfit), { bold: true })}
            {pnl.expensesByCategory.map((e) =>
              row(
                <Link
                  href={`/ledgers/expenses/${e.category.toLowerCase()}`}
                  className="text-accent underline underline-offset-2"
                >
                  {EXPENSE_CATEGORY_LABELS[e.category as ExpenseCategory]}
                </Link>,
                fmtMoney(e.amount.negated()),
                { cls: "text-debit", indent: true }
              )
            )}
            {row("Total expenses", fmtMoney(pnl.totalExpenses.negated()), { cls: "text-debit" })}
            {row(
              <>
                Aged outstanding treated as loss
                <span className="text-muted"> (unrecovered for over {AGED_LOSS_DAYS} days)</span>
              </>,
              fmtMoney(pnl.agedLoss.negated()),
              { cls: "text-debit" }
            )}
            {row(<span className="heading font-semibold text-[15px]">Net profit</span>, fmtMoney(pnl.netProfit), { bold: true, cls: netCls })}
          </tbody>
        </table>
      </div>

      <p className="text-muted text-[12px] mt-3 max-w-xl">
        Accrual figures: revenue counts what buyers owe at locked rates, even
        if short-paid (the shortfall sits on their ledger as price-variance
        debt). Uncollected balances older than {AGED_LOSS_DAYS} days are
        counted as loss automatically — nothing is written off by hand.
      </p>
    </div>
  );
}
