import { Prisma } from "@/generated/prisma/client";
import { requireReports } from "@/lib/session";
import { getActiveScope } from "@/lib/centre";
import { computeProfit } from "@/lib/report";
import { NoCentreNotice } from "../../no-centre";
import { PURCHASE_TYPE_LABELS } from "@/lib/purchase";
import { EXPENSE_CATEGORY_LABELS } from "@/lib/expense";
import { SALE_TYPE_LABELS } from "@/lib/sale";
import { businessTodayDate, fmtDate, fmtMoney, toInputDate } from "@/lib/format";
import { DateField } from "../../date-field";

function monthStart(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

export default async function ProfitReportPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  await requireReports();
  const { company, centre } = await getActiveScope();
  if (!centre) return <NoCentreNotice companyName={company.name} />;

  const sp = await searchParams;
  const today = businessTodayDate();
  const from =
    sp.from && /^\d{4}-\d{2}-\d{2}$/.test(sp.from)
      ? new Date(sp.from)
      : monthStart(today);
  const to =
    sp.to && /^\d{4}-\d{2}-\d{2}$/.test(sp.to) ? new Date(sp.to) : today;

  const r = await computeProfit(company.id, centre.id, from, to);
  const pfCls = r.profit.greaterThan(0)
    ? "text-credit"
    : r.profit.lessThan(0)
      ? "text-debit"
      : "";

  return (
    <div className="max-w-3xl">
      <div className="flex items-end justify-between mb-4 flex-wrap gap-3">
        <div>
          <h1 className="heading text-xl font-semibold">Profit</h1>
          <p className="text-muted text-[13px]">
            {company.name} · {centre.name} · {fmtDate(from)} → {fmtDate(to)}
          </p>
        </div>
        <form method="GET" className="flex items-end gap-2">
          <div>
            <label
              htmlFor="from"
              className="block text-[11px] uppercase tracking-wide text-muted font-semibold mb-1"
            >
              From
            </label>
            <DateField
              id="from"
              name="from"
              
              defaultValue={toInputDate(from)}
              className="border border-line-strong bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent"
            />
          </div>
          <div>
            <label
              htmlFor="to"
              className="block text-[11px] uppercase tracking-wide text-muted font-semibold mb-1"
            >
              To
            </label>
            <DateField
              id="to"
              name="to"
              
              defaultValue={toInputDate(to)}
              className="border border-line-strong bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent"
            />
          </div>
          <button
            type="submit"
            className="bg-accent text-white px-3 py-1.5 text-[13px] font-semibold"
          >
            Show
          </button>
        </form>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        <Stat label="Sale" value={r.sale} cls="text-credit" />
        <Stat label="Purchase" value={r.purchase} cls="text-debit" />
        <Stat label="Expense" value={r.expense} cls="text-debit" />
        <Stat label="Profit" value={r.profit} cls={pfCls} strong />
      </div>

      <div className="grid sm:grid-cols-3 gap-3">
        <Breakdown
          title="Purchase by type"
          rows={r.purchaseByType.map((x) => ({
            label: PURCHASE_TYPE_LABELS[x.type],
            amount: x.amount,
          }))}
          total={r.purchase}
        />
        <Breakdown
          title="Expense by category"
          rows={r.expenseByCategory.map((x) => ({
            label: EXPENSE_CATEGORY_LABELS[x.category],
            amount: x.amount,
          }))}
          total={r.expense}
        />
        <Breakdown
          title="Sale by type"
          rows={r.saleByType.map((x) => ({
            label: SALE_TYPE_LABELS[x.type],
            amount: x.amount,
          }))}
          total={r.sale}
        />
      </div>
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
    <div
      className={`border bg-surface px-4 py-3 ${
        strong ? "border-line-strong" : "border-line"
      }`}
    >
      <div className="text-[11px] uppercase tracking-wide text-muted font-semibold">
        {label}
      </div>
      <div className={`num ${strong ? "text-2xl" : "text-xl"} font-bold mt-1 ${cls ?? ""}`}>
        {fmtMoney(value)}
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
              <td className="py-0.5 num text-right">{fmtMoney(total)}</td>
            </tr>
          </tbody>
        </table>
      )}
    </div>
  );
}
