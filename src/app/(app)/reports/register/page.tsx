import Link from "next/link";
import { Prisma } from "@/generated/prisma/client";
import { requireSession } from "@/lib/session";
import { getActiveCompany } from "@/lib/company";
import { computeProfit, getTransactionRegister } from "@/lib/report";
import { PURCHASE_TYPE_LABELS } from "@/lib/purchase";
import { EXPENSE_CATEGORY_LABELS } from "@/lib/expense";
import { SALE_TYPE_LABELS } from "@/lib/sale";
import { businessTodayDate, fmtDate, fmtMoney, toInputDate } from "@/lib/format";

type SearchParams = { from?: string; to?: string };

function parseRange(sp: SearchParams) {
  const today = businessTodayDate();
  const from =
    sp.from && /^\d{4}-\d{2}-\d{2}$/.test(sp.from)
      ? new Date(sp.from)
      : new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  const to =
    sp.to && /^\d{4}-\d{2}-\d{2}$/.test(sp.to) ? new Date(sp.to) : today;
  return { from, to };
}

const KIND_LABELS: Record<string, string> = {
  PURCHASE: "Purchase",
  SALE: "Sale",
  EXPENSE: "Expense",
};

function subtypeLabel(kind: string, subtype: string) {
  if (kind === "PURCHASE")
    return PURCHASE_TYPE_LABELS[subtype as keyof typeof PURCHASE_TYPE_LABELS] ?? subtype;
  if (kind === "SALE")
    return SALE_TYPE_LABELS[subtype as keyof typeof SALE_TYPE_LABELS] ?? subtype;
  return EXPENSE_CATEGORY_LABELS[subtype as keyof typeof EXPENSE_CATEGORY_LABELS] ?? subtype;
}

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireSession();
  const company = await getActiveCompany();
  const sp = await searchParams;
  const { from, to } = parseRange(sp);

  const [rows, pl] = await Promise.all([
    getTransactionRegister(company.id, from, to),
    computeProfit(company.id, from, to),
  ]);

  // Quick-range presets.
  const now = businessTodayDate();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const iso = (d: Date) => toInputDate(d);
  const presets = [
    { label: "Today", from: iso(now), to: iso(now) },
    {
      label: "This month",
      from: iso(new Date(Date.UTC(y, m, 1))),
      to: iso(new Date(Date.UTC(y, m + 1, 0))),
    },
    {
      label: "This year",
      from: iso(new Date(Date.UTC(y, 0, 1))),
      to: iso(new Date(Date.UTC(y, 11, 31))),
    },
  ];

  const pfCls = pl.profit.greaterThan(0)
    ? "text-credit"
    : pl.profit.lessThan(0)
      ? "text-debit"
      : "";

  return (
    <div className="max-w-4xl">
      <div className="flex items-end justify-between mb-3 flex-wrap gap-3">
        <div>
          <h1 className="heading text-xl font-semibold">Daily Transactions</h1>
          <p className="text-muted text-[13px]">
            {company.name} · all centres · {fmtDate(from)} → {fmtDate(to)}
          </p>
        </div>
        <form method="GET" className="flex items-end gap-2">
          <div>
            <label htmlFor="from" className="block text-[11px] uppercase tracking-wide text-muted font-semibold mb-1">
              From
            </label>
            <input id="from" name="from" type="date" defaultValue={toInputDate(from)} className="border border-line-strong bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent" />
          </div>
          <div>
            <label htmlFor="to" className="block text-[11px] uppercase tracking-wide text-muted font-semibold mb-1">
              To
            </label>
            <input id="to" name="to" type="date" defaultValue={toInputDate(to)} className="border border-line-strong bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent" />
          </div>
          <button type="submit" className="bg-accent text-white px-3 py-1.5 text-[13px] font-semibold">
            Show
          </button>
        </form>
      </div>

      <div className="flex gap-2 mb-4">
        {presets.map((p) => (
          <Link
            key={p.label}
            href={`/reports/register?from=${p.from}&to=${p.to}`}
            className="border border-line-strong bg-surface px-3 py-1 text-[12px] font-semibold hover:border-accent"
          >
            {p.label}
          </Link>
        ))}
      </div>

      {/* Transactions register */}
      <div className="border border-line-strong bg-surface mb-5">
        <table className="ledger-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Centre</th>
              <th>Type</th>
              <th>Party</th>
              <th className="num-col">Purchase</th>
              <th className="num-col">Expense</th>
              <th className="num-col">Sale</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-muted text-[13px] px-4 py-3">
                  No transactions in this range.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={`${r.kind}-${r.id}`}>
                  <td className="whitespace-nowrap">{fmtDate(r.date)}</td>
                  <td className="text-muted">{r.centreName}</td>
                  <td>
                    <Link href={r.href} className="text-accent underline underline-offset-2">
                      {KIND_LABELS[r.kind]} · {subtypeLabel(r.kind, r.subtype)}
                    </Link>
                  </td>
                  <td className="font-medium">{r.partyName}</td>
                  <td className="num-col num text-debit">
                    {r.kind === "PURCHASE" ? fmtMoney(r.amount) : ""}
                  </td>
                  <td className="num-col num text-debit">
                    {r.kind === "EXPENSE" ? fmtMoney(r.amount) : ""}
                  </td>
                  <td className="num-col num text-credit">
                    {r.kind === "SALE" ? fmtMoney(r.amount) : ""}
                  </td>
                </tr>
              ))
            )}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="border-t border-line-strong font-semibold">
                <td colSpan={4} className="text-right">Totals</td>
                <td className="num-col num text-debit">{fmtMoney(pl.purchase)}</td>
                <td className="num-col num text-debit">{fmtMoney(pl.expense)}</td>
                <td className="num-col num text-credit">{fmtMoney(pl.sale)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* P/L for the selection */}
      <h2 className="heading text-[15px] font-semibold mb-2">
        Profit / Loss · {fmtDate(from)} → {fmtDate(to)}
      </h2>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="Sale" value={pl.sale} cls="text-credit" />
        <Stat label="Purchase" value={pl.purchase} cls="text-debit" />
        <Stat label="Expense" value={pl.expense} cls="text-debit" />
        <Stat label="Profit" value={pl.profit} cls={pfCls} strong />
      </div>
      <p className="text-muted text-[12px] mt-2">
        Profit = Sale − (Purchase + Expense), company-wide across all centres.
      </p>
    </div>
  );
}

function Stat({
  label,
  value,
  cls,
  strong,
}: {
  label: string;
  value: Prisma.Decimal;
  cls?: string;
  strong?: boolean;
}) {
  return (
    <div className={`border bg-surface px-4 py-3 ${strong ? "border-line-strong" : "border-line"}`}>
      <div className="text-[11px] uppercase tracking-wide text-muted font-semibold">
        {label}
      </div>
      <div className={`num ${strong ? "text-2xl" : "text-xl"} font-bold mt-1 ${cls ?? ""}`}>
        {fmtMoney(value)}
      </div>
    </div>
  );
}
