import Link from "next/link";
import { Prisma } from "@/generated/prisma/client";
import { requireReports } from "@/lib/session";
import { getActiveScope } from "@/lib/centre";
import { computeProfit } from "@/lib/report";
import { NoCentreNotice } from "../../no-centre";
import { PURCHASE_TYPE_LABELS } from "@/lib/purchase";
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
  const pfCls = r.grossProfit.greaterThan(0)
    ? "text-credit"
    : r.grossProfit.lessThan(0)
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

      {/* Same period, on paper — the browser's print dialog is also where
          Save as PDF lives. Carries the dates that are on screen. */}
      <div className="mb-4">
        <Link
          href={`/reports/profit/print?from=${toInputDate(from)}&to=${toInputDate(to)}`}
          className="border border-line-strong bg-surface px-3 py-1 text-[12px] font-semibold hover:border-accent"
        >
          Print / Save as PDF
        </Link>
      </div>

      {/* Two tiers, per spec §2. Gross belongs to a buying day and is charged
          only the DIRECT costs of that catch; overheads belong to the month
          and touch net alone. Showing one "profit" number hid which of the two
          you were reading, and they answer different questions. */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
        <Stat label="Revenue" value={r.sale} cls="text-credit" />
        <Stat label="Purchases" value={r.purchase} cls="text-debit" />
        <Stat label="Direct expenses" value={r.directExpense} cls="text-debit" />
        <Stat label="Gross profit" value={r.grossProfit} cls={pfCls} strong />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        <Stat label="Overheads" value={r.overheadExpense} cls="text-debit" />
        <Stat
          label="Reserve collected"
          value={r.reserveCollected}
          cls="text-credit"
        />
        <Stat
          label="Net profit"
          value={r.netProfit}
          cls={
            r.netProfit.greaterThan(0)
              ? "text-credit"
              : r.netProfit.lessThan(0)
                ? "text-debit"
                : ""
          }
          strong
        />
      </div>

      <p className="text-muted text-[12px] mb-5 max-w-2xl">
        <span className="font-semibold text-foreground">Gross</span> is revenue
        less purchases and the direct costs of the catch — ice, loaders, ladies,
        batha, canteen and vehicle rent. It is the figure that belongs to a
        buying day.{" "}
        <span className="font-semibold text-foreground">Net</span> takes off the
        month&rsquo;s overheads and adds back reserve as it is collected. A
        salary never moves the gross figure.
      </p>

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
            label: x.name,
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
