import Link from "next/link";
import { Prisma } from "@/generated/prisma/client";
import { requireReports } from "@/lib/session";
import { getActiveScope } from "@/lib/centre";
import {
  computePeriodBreakdown,
  computeProfit,
  getTransactionRegister,
  type PeriodBucket,
} from "@/lib/report";
import { PURCHASE_TYPE_LABELS } from "@/lib/purchase";
import { EXPENSE_CATEGORY_LABELS } from "@/lib/expense";
import { SALE_TYPE_LABELS } from "@/lib/sale";
import { SETTLEMENT_MODE_LABELS } from "@/lib/settlement";
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

const ZERO = new Prisma.Decimal(0);

const KIND_LABELS: Record<string, string> = {
  PURCHASE: "Purchase",
  SALE: "Sale",
  EXPENSE: "Expense",
  PAYMENT: "Payment",
  RECEIPT: "Receipt",
};

function subtypeLabel(kind: string, subtype: string) {
  if (kind === "PAYMENT" || kind === "RECEIPT")
    return SETTLEMENT_MODE_LABELS[subtype as keyof typeof SETTLEMENT_MODE_LABELS] ?? subtype;
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
  // Day is the default: opening the report should answer "what happened
  // today", not present a month grid that has to be drilled into.
  const view: View =
    sp.view === "month" || sp.view === "year" ? sp.view : "day";
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

/**
 * Same instant re-expressed for a different view, so switching tabs keeps
 * place.
 *
 * Narrowing needs an anchor *inside* the range, and the start of it is a poor
 * guess: switching from August to Day landed on the 1st, which for most of the
 * month is a day with no trade — the report looked broken when it was merely
 * pointed at an empty date. Today is the useful answer whenever the range
 * contains it; otherwise fall back to where the range starts.
 */
function periodFor(view: View, from: Date, to: Date): string {
  const today = businessToday();
  const inRange = today >= toInputDate(from) && today <= toInputDate(to);
  const anchor = inRange ? today : toInputDate(from);
  return view === "day"
    ? anchor
    : view === "month"
      ? anchor.slice(0, 7)
      : anchor.slice(0, 4);
}

function href(view: View, period: string, scope: string) {
  return `/reports/register?view=${view}&period=${period}&scope=${scope}`;
}

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireReports();
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
            href={href(v.id, periodFor(v.id, from, to), scope)}
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
        <Link
          href={`/reports/register/export?view=${view}&period=${period}&scope=${scope}`}
          className="ml-auto border border-line-strong bg-surface px-3 py-1 text-[12px] font-semibold hover:border-accent"
        >
          Export CSV
        </Link>
        <span className="flex gap-2">
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
  // Both queries take the same scope, so the tiles under the table are always
  // the totals of the table above them — no re-summing in JS.
  const [rows, pl] = await Promise.all([
    getTransactionRegister(companyId, date, date, centreId),
    computeProfit(companyId, centreId, date, date),
  ]);

  const { purchase, sale, expense, profit } = pl;

  // Settlements are money moving, not trade, so they are totalled separately
  // and deliberately left out of `profit` — counting a payment as a cost would
  // charge the same purchase twice.
  const settledOut = rows
    .filter((r) => r.kind === "PAYMENT")
    .reduce((a, r) => a.add(r.amount), ZERO);
  const settledIn = rows
    .filter((r) => r.kind === "RECEIPT")
    .reduce((a, r) => a.add(r.amount), ZERO);

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
              <th className="num-col">Paid</th>
              <th className="num-col">Received</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="text-muted text-[13px] px-4 py-3">
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
                  <td className="num-col num text-debit">
                    {r.kind === "PAYMENT" ? fmtMoney(r.amount) : ""}
                  </td>
                  <td className="num-col num text-credit">
                    {r.kind === "RECEIPT" ? fmtMoney(r.amount) : ""}
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
                <td className="num-col num text-debit">{fmtMoney(settledOut)}</td>
                <td className="num-col num text-credit">{fmtMoney(settledIn)}</td>
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
      <div className="border border-line-strong bg-surface mb-5 mt-3">
        <table className="ledger-table">
          <thead>
            <tr>
              <th>{bucket === "day" ? "Day" : "Month"}</th>
              <th className="num-col">Purchase</th>
              <th className="num-col">Expense</th>
              <th className="num-col">Sale</th>
              <th className="num-col">Profit / Loss</th>
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
                  <td className="num-col num text-debit">{money(b.purchase)}</td>
                  <td className="num-col num text-debit">{money(b.expense)}</td>
                  <td className="num-col num text-credit">{money(b.sale)}</td>
                  <td
                    className={`num-col num font-semibold ${profitClass(b.profit)}`}
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
              <td className="num-col num text-debit">{money(total.purchase)}</td>
              <td className="num-col num text-debit">{money(total.expense)}</td>
              <td className="num-col num text-credit">{money(total.sale)}</td>
              <td className={`num-col num ${profitClass(total.profit)}`}>
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
