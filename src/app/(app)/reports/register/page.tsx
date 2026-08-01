import Link from "next/link";
import { Prisma } from "@/generated/prisma/client";
import { requireSession } from "@/lib/session";
import { getActiveScope } from "@/lib/centre";
import {
  computePeriodBreakdown,
  computeProfit,
  getTransactionRegister,
  type PeriodBucket,
} from "@/lib/report";
import { PURCHASE_TYPES, PURCHASE_TYPE_LABELS } from "@/lib/purchase";
import { EXPENSE_CATEGORIES, EXPENSE_CATEGORY_LABELS } from "@/lib/expense";
import { SALE_TYPES, SALE_TYPE_LABELS } from "@/lib/sale";
import { businessToday, fmtDate, fmtMoney, toInputDate } from "@/lib/format";
import { NoCentreNotice } from "../../no-centre";

// Day / Month / Year transactions report.
//
//   day    every individual transaction on one date
//   month  one row per calendar day, totalled — including days with no trade
//   year   one row per calendar month, totalled
//
// Month and year rows drill down one level: a month row opens that month's
// days, a day row opens that day's transactions.

type View = "day" | "month" | "year";
type SearchParams = { view?: string; period?: string; scope?: string };

const VIEWS: { id: View; label: string }[] = [
  { id: "day", label: "Day" },
  { id: "month", label: "Month" },
  { id: "year", label: "Year" },
];

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

/**
 * The selected period, as an anchor date plus the [from, to] it covers.
 *
 * All three views share one `period` parameter, distinguished by length:
 * "2026-08-14", "2026-08", "2026". Anything malformed falls back to today, so a
 * hand-edited URL shows the current period instead of an error.
 */
function parsePeriod(sp: SearchParams): {
  view: View;
  period: string;
  from: Date;
  to: Date;
  label: string;
} {
  const view: View =
    sp.view === "day" || sp.view === "year" ? sp.view : "month";
  const today = businessToday(); // "YYYY-MM-DD" in IST

  if (view === "day") {
    const period = /^\d{4}-\d{2}-\d{2}$/.test(sp.period ?? "")
      ? sp.period!
      : today;
    const d = new Date(`${period}T00:00:00.000Z`);
    return { view, period, from: d, to: d, label: fmtDate(d) };
  }

  if (view === "year") {
    const period = /^\d{4}$/.test(sp.period ?? "")
      ? sp.period!
      : today.slice(0, 4);
    const y = Number(period);
    return {
      view,
      period,
      from: new Date(Date.UTC(y, 0, 1)),
      to: new Date(Date.UTC(y, 11, 31)),
      label: period,
    };
  }

  const period = /^\d{4}-\d{2}$/.test(sp.period ?? "")
    ? sp.period!
    : today.slice(0, 7);
  const [y, m] = period.split("-").map(Number);
  const from = new Date(Date.UTC(y, m - 1, 1));
  const to = new Date(Date.UTC(y, m, 0)); // day 0 of next month = last of this
  return {
    view,
    period,
    from,
    to,
    label: from.toLocaleDateString("en-IN", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }),
  };
}

/** Same instant re-expressed for a different view, so switching tabs keeps place. */
function periodFor(view: View, from: Date): string {
  const iso = toInputDate(from);
  return view === "day" ? iso : view === "month" ? iso.slice(0, 7) : iso.slice(0, 4);
}

function href(view: View, period: string, scope: string) {
  return `/reports/register?view=${view}&period=${period}&scope=${scope}`;
}

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireSession();
  const { company, centre } = await getActiveScope();
  if (!centre) return <NoCentreNotice companyName={company.name} />;

  const sp = await searchParams;
  const { view, period, from, to, label } = parsePeriod(sp);

  // Centre-scoped by default. Profit is only strictly meaningful company-wide —
  // a purchase and the sale of the same fish can sit in different centres — so
  // the toggle exists and the caveat is stated under the table.
  const companyWide = sp.scope === "company";
  const scope = companyWide ? "company" : "centre";
  const centreId = companyWide ? null : centre.id;

  return (
    <div>
      <div className="flex items-end justify-between mb-3 flex-wrap gap-3">
        <div>
          <h1 className="heading text-xl font-semibold">Transactions Report</h1>
          <p className="text-muted text-[13px]">
            {company.name} · {companyWide ? "all centres" : centre.name} ·{" "}
            {label}
          </p>
        </div>

        <form method="GET" className="flex items-end gap-2">
          <input type="hidden" name="view" value={view} />
          <input type="hidden" name="scope" value={scope} />
          <div>
            <label
              htmlFor="period"
              className="block text-[11px] uppercase tracking-wide text-muted font-semibold mb-1"
            >
              {view === "day" ? "Date" : view === "month" ? "Month" : "Year"}
            </label>
            <input
              id="period"
              name="period"
              type={view === "day" ? "date" : view === "month" ? "month" : "number"}
              min={view === "year" ? 2000 : undefined}
              max={view === "year" ? 2100 : undefined}
              defaultValue={period}
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

      <div className="flex gap-2 mb-1 flex-wrap">
        {VIEWS.map((v) => (
          <Link
            key={v.id}
            href={href(v.id, periodFor(v.id, from), scope)}
            aria-current={v.id === view ? "page" : undefined}
            className={
              "border px-3 py-1 text-[12px] font-semibold " +
              (v.id === view
                ? "bg-accent text-white border-accent"
                : "border-line-strong bg-surface hover:border-accent")
            }
          >
            {v.label}
          </Link>
        ))}
        <span className="ml-auto flex gap-2">
          <Link
            href={href(view, period, "centre")}
            aria-current={!companyWide ? "page" : undefined}
            className={
              "border px-3 py-1 text-[12px] font-semibold " +
              (!companyWide
                ? "bg-accent text-white border-accent"
                : "border-line-strong bg-surface hover:border-accent")
            }
          >
            This centre
          </Link>
          <Link
            href={href(view, period, "company")}
            aria-current={companyWide ? "page" : undefined}
            className={
              "border px-3 py-1 text-[12px] font-semibold " +
              (companyWide
                ? "bg-accent text-white border-accent"
                : "border-line-strong bg-surface hover:border-accent")
            }
          >
            All centres
          </Link>
        </span>
      </div>

      {view === "day" ? (
        <DayView
          companyId={company.id}
          centreId={centreId}
          date={from}
          companyWide={companyWide}
        />
      ) : (
        <BreakdownView
          companyId={company.id}
          centreId={centreId}
          from={from}
          to={to}
          bucket={view === "month" ? "day" : "month"}
          scope={scope}
          companyWide={companyWide}
        />
      )}
    </div>
  );
}

/** Every individual transaction on one date. */
async function DayView({
  companyId,
  centreId,
  date,
  companyWide,
}: {
  companyId: string;
  centreId: string | null;
  date: Date;
  companyWide: boolean;
}) {
  const [rows, pl] = await Promise.all([
    getTransactionRegister(companyId, date, date, centreId),
    computeProfit(companyId, date, date),
  ]);

  // computeProfit is company-wide only, so when the report is scoped to one
  // centre the tiles are summed from the rows instead — otherwise the totals
  // under the table would not match the table above them.
  const ZERO = new Prisma.Decimal(0);
  const sum = (kind: string) =>
    rows.filter((r) => r.kind === kind).reduce((a, r) => a.add(r.amount), ZERO);
  const purchase = companyWide ? pl.purchase : sum("PURCHASE");
  const sale = companyWide ? pl.sale : sum("SALE");
  const expense = companyWide ? pl.expense : sum("EXPENSE");
  const profit = sale.sub(purchase).sub(expense);

  return (
    <>
      <div className="border border-line-strong bg-surface mb-5 mt-3 overflow-x-auto">
        <table className="ledger-table">
          <thead>
            <tr>
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
                <td colSpan={6} className="text-muted text-[13px] px-4 py-3">
                  No transactions on this date.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={`${r.kind}-${r.id}`}>
                  <td className="text-muted">{r.centreName}</td>
                  <td>
                    <Link
                      href={r.href}
                      className="text-accent underline underline-offset-2"
                    >
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
                <td colSpan={3} className="text-right">
                  Totals
                </td>
                <td className="num-col num text-debit">{fmtMoney(purchase)}</td>
                <td className="num-col num text-debit">{fmtMoney(expense)}</td>
                <td className="num-col num text-credit">{fmtMoney(sale)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="Sale" value={sale} cls="text-credit" />
        <Stat label="Purchase" value={purchase} cls="text-debit" />
        <Stat label="Expense" value={expense} cls="text-debit" />
        <Stat
          label="Profit"
          value={profit}
          cls={profitClass(profit)}
          strong
        />
      </div>
      <Caveat companyWide={companyWide} />
    </>
  );
}

/** One row per day (month view) or per month (year view), broken down by type. */
async function BreakdownView({
  companyId,
  centreId,
  from,
  to,
  bucket,
  scope,
  companyWide,
}: {
  companyId: string;
  centreId: string | null;
  from: Date;
  to: Date;
  bucket: "day" | "month";
  scope: string;
  companyWide: boolean;
}) {
  const { buckets, total } = await computePeriodBreakdown({
    companyId,
    centreId,
    from,
    to,
    bucket,
  });

  // A day row opens that day's transactions; a month row opens that month.
  const rowHref = (b: PeriodBucket) =>
    bucket === "day"
      ? href("day", b.key, scope)
      : href("month", b.key, scope);

  return (
    <>
      <div className="border border-line-strong bg-surface mb-5 mt-3 overflow-x-auto">
        <table className="ledger-table whitespace-nowrap">
          <thead>
            <tr>
              <th rowSpan={2}>{bucket === "day" ? "Day" : "Month"}</th>
              <th colSpan={PURCHASE_TYPES.length + 1} className="text-center border-l border-line-strong">
                Purchase
              </th>
              <th colSpan={SALE_TYPES.length + 1} className="text-center border-l border-line-strong">
                Sale
              </th>
              <th colSpan={EXPENSE_CATEGORIES.length + 1} className="text-center border-l border-line-strong">
                Expense
              </th>
              <th rowSpan={2} className="num-col border-l border-line-strong">
                Profit / Loss
              </th>
            </tr>
            <tr>
              {PURCHASE_TYPES.map((t, i) => (
                <th key={t} className={`num-col ${i === 0 ? "border-l border-line-strong" : ""}`}>
                  {PURCHASE_TYPE_LABELS[t]}
                </th>
              ))}
              <th className="num-col font-bold">Total</th>
              {SALE_TYPES.map((t, i) => (
                <th key={t} className={`num-col ${i === 0 ? "border-l border-line-strong" : ""}`}>
                  {SALE_TYPE_LABELS[t]}
                </th>
              ))}
              <th className="num-col font-bold">Total</th>
              {EXPENSE_CATEGORIES.map((c, i) => (
                <th key={c} className={`num-col ${i === 0 ? "border-l border-line-strong" : ""}`}>
                  {EXPENSE_CATEGORY_LABELS[c]}
                </th>
              ))}
              <th className="num-col font-bold">Total</th>
            </tr>
          </thead>
          <tbody>
            {buckets.map((b) => {
              const quiet = b.purchase.isZero() && b.sale.isZero() && b.expense.isZero();
              return (
                <tr key={b.key} className={quiet ? "text-muted" : ""}>
                  <td className="font-medium">
                    {quiet ? (
                      b.label
                    ) : (
                      <Link
                        href={rowHref(b)}
                        className="text-accent underline underline-offset-2"
                      >
                        {b.label}
                      </Link>
                    )}
                  </td>
                  {PURCHASE_TYPES.map((t, i) => (
                    <td key={t} className={`num-col num ${i === 0 ? "border-l border-line-strong" : ""}`}>
                      {money(b.purchaseByType[t])}
                    </td>
                  ))}
                  <td className="num-col num font-semibold text-debit">
                    {money(b.purchase)}
                  </td>
                  {SALE_TYPES.map((t, i) => (
                    <td key={t} className={`num-col num ${i === 0 ? "border-l border-line-strong" : ""}`}>
                      {money(b.saleByType[t])}
                    </td>
                  ))}
                  <td className="num-col num font-semibold text-credit">
                    {money(b.sale)}
                  </td>
                  {EXPENSE_CATEGORIES.map((c, i) => (
                    <td key={c} className={`num-col num ${i === 0 ? "border-l border-line-strong" : ""}`}>
                      {money(b.expenseByCategory[c])}
                    </td>
                  ))}
                  <td className="num-col num font-semibold text-debit">
                    {money(b.expense)}
                  </td>
                  <td
                    className={`num-col num font-semibold border-l border-line-strong ${profitClass(b.profit)}`}
                  >
                    {money(b.profit)}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t border-line-strong font-bold">
              <td>Total</td>
              {PURCHASE_TYPES.map((t, i) => (
                <td key={t} className={`num-col num ${i === 0 ? "border-l border-line-strong" : ""}`}>
                  {money(total.purchaseByType[t])}
                </td>
              ))}
              <td className="num-col num text-debit">{money(total.purchase)}</td>
              {SALE_TYPES.map((t, i) => (
                <td key={t} className={`num-col num ${i === 0 ? "border-l border-line-strong" : ""}`}>
                  {money(total.saleByType[t])}
                </td>
              ))}
              <td className="num-col num text-credit">{money(total.sale)}</td>
              {EXPENSE_CATEGORIES.map((c, i) => (
                <td key={c} className={`num-col num ${i === 0 ? "border-l border-line-strong" : ""}`}>
                  {money(total.expenseByCategory[c])}
                </td>
              ))}
              <td className="num-col num text-debit">{money(total.expense)}</td>
              <td
                className={`num-col num border-l border-line-strong ${profitClass(total.profit)}`}
              >
                {money(total.profit)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="Sale" value={total.sale} cls="text-credit" />
        <Stat label="Purchase" value={total.purchase} cls="text-debit" />
        <Stat label="Expense" value={total.expense} cls="text-debit" />
        <Stat
          label="Profit"
          value={total.profit}
          cls={profitClass(total.profit)}
          strong
        />
      </div>
      <Caveat companyWide={companyWide} />
    </>
  );
}

/** Zero reads as a dash — a grid of "₹0.00" is unreadable at 31 rows. */
function money(v: Prisma.Decimal): string {
  return v.isZero() ? "–" : fmtMoney(v);
}

function profitClass(v: Prisma.Decimal): string {
  return v.greaterThan(0) ? "text-credit" : v.lessThan(0) ? "text-debit" : "";
}

function Caveat({ companyWide }: { companyWide: boolean }) {
  return (
    <p className="text-muted text-[12px] mt-2">
      Profit = Sale − (Purchase + Expense). Flagged-error vouchers are excluded.
      {!companyWide && (
        <>
          {" "}
          Figures cover this centre only — where a purchase and the sale of the
          same fish sit in different centres, per-centre profit will mislead.
          Use <span className="font-semibold">All centres</span> for a true
          company figure.
        </>
      )}
    </p>
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
