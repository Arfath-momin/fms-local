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
import {
  REGISTER_KIND_LABELS,
  registerSubtypeLabel,
} from "@/lib/register-labels";
import { fmtDate, fmtMoney, toInputDate } from "@/lib/format";
import {
  MAX_RANGE_DAYS,
  MAX_RANGE_ROWS,
  parseRegisterPeriod,
  registerHref,
  REGISTER_VIEWS,
  type RegisterParams,
  type RegisterView,
} from "@/lib/register-period";
import { NoCentreNotice } from "../../no-centre";
import { DateField } from "../../date-field";

// Day / Range / Month / Year transactions report.
//
//   day    every individual transaction on one date
//   range  every individual transaction between two dates
//   month  one row per calendar day, totalled — including days with no trade
//   year   one row per calendar month, totalled
//
// Month and year rows drill down one level: a month row opens that month's
// days, a day row opens that day's transactions.
//
// The period parsing lives in @/lib/register-period because the CSV export
// route has to resolve the same query string to the same window.

const ZERO = new Prisma.Decimal(0);

const filterLabelCls =
  "block text-[11px] uppercase tracking-wide text-muted font-semibold mb-1";
const filterInputCls =
  "border border-line-strong bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent";

const tabCls = (active: boolean) =>
  "border px-3 py-1 text-[12px] font-semibold " +
  (active
    ? "bg-accent text-white border-accent"
    : "border-line-strong bg-surface hover:border-accent");

/** The CSV export carries whichever period fields the current view uses. */
function exportHref(
  view: RegisterView,
  p: { period: string; from: Date; to: Date; scope: string }
): string {
  const params = new URLSearchParams({ view, scope: p.scope });
  if (view === "range") {
    params.set("from", toInputDate(p.from));
    params.set("to", toInputDate(p.to));
  } else {
    params.set("period", p.period);
  }
  return `/reports/register/export?${params}`;
}

/** The printable view of the same window — see exportHref. */
function printHref(
  view: RegisterView,
  p: { period: string; from: Date; to: Date; scope: string }
): string {
  const params = new URLSearchParams();
  params.set("view", view);
  params.set("scope", p.scope);
  if (view === "range") {
    params.set("from", toInputDate(p.from));
    params.set("to", toInputDate(p.to));
  } else {
    params.set("period", p.period);
  }
  return `/reports/register/print?${params}`;
}

// Both label maps now live in @/lib/register-labels, shared with the printable
// view so the two renderings of the same row cannot drift apart.
const KIND_LABELS = REGISTER_KIND_LABELS;
const subtypeLabel = registerSubtypeLabel;

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<RegisterParams>;
}) {
  await requireReports();
  const { company, centre } = await getActiveScope();
  if (!centre) return <NoCentreNotice companyName={company.name} />;

  const sp = await searchParams;
  const { view, period, from, to, label, clamped } = parseRegisterPeriod(sp);

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

        <form method="GET" className="flex items-end gap-2 flex-wrap">
          <input type="hidden" name="view" value={view} />
          <input type="hidden" name="scope" value={scope} />
          {view === "range" ? (
            <>
              <div>
                <label htmlFor="from" className={filterLabelCls}>
                  From
                </label>
                <DateField
                  id="from"
                  name="from"
                  
                  defaultValue={toInputDate(from)}
                  className={filterInputCls}
                />
              </div>
              <div>
                <label htmlFor="to" className={filterLabelCls}>
                  To
                </label>
                <DateField
                  id="to"
                  name="to"
                  
                  defaultValue={toInputDate(to)}
                  className={filterInputCls}
                />
              </div>
            </>
          ) : (
            <div>
              <label htmlFor="period" className={filterLabelCls}>
                {view === "day" ? "Date" : view === "month" ? "Month" : "Year"}
              </label>
              {/* Day goes through DateField like every other date in the app.
                  It was the one field still left as a native `type="date"`,
                  which renders in the BROWSER's locale — so on a machine set to
                  US English this single box read mm/dd/yyyy while the report
                  underneath it, and the From/To boxes beside it, all read
                  dd/mm/yyyy. Month and year are untouched: "August 2026" and
                  "2026" carry no day to be ambiguous about. */}
              {view === "day" ? (
                <DateField
                  id="period"
                  name="period"
                  defaultValue={period}
                  className={filterInputCls}
                />
              ) : (
                <input
                  id="period"
                  name="period"
                  type={view === "month" ? "month" : "number"}
                  min={view === "year" ? 2000 : undefined}
                  max={view === "year" ? 2100 : undefined}
                  defaultValue={period}
                  className={filterInputCls}
                />
              )}
            </div>
          )}
          <button
            type="submit"
            className="bg-accent text-white px-3 py-1.5 text-[13px] font-semibold"
          >
            Show
          </button>
        </form>
      </div>

      <div className="flex gap-2 mb-1 flex-wrap">
        {REGISTER_VIEWS.map((v) => (
          <Link
            key={v.id}
            href={registerHref(v.id, { period: "", from, to, scope })}
            aria-current={v.id === view ? "page" : undefined}
            className={tabCls(v.id === view)}
          >
            {v.label}
          </Link>
        ))}
        <a
          href={exportHref(view, { period, from, to, scope })}
          className="ml-auto border border-line-strong bg-surface px-3 py-1 text-[12px] font-semibold hover:border-accent"
        >
          Export CSV
        </a>
        {/* Same period, same scope, on paper. CSV is for a spreadsheet; this is
            for a file or a folder — the browser's print dialog is also where
            Save as PDF lives. Both links carry the window that is on screen. */}
        <Link
          href={printHref(view, { period, from, to, scope })}
          className="border border-line-strong bg-surface px-3 py-1 text-[12px] font-semibold hover:border-accent"
        >
          Save as PDF
        </Link>
        <span className="flex gap-2">
          <Link
            href={registerHref(view, { period, from, to, scope: "centre" })}
            aria-current={!companyWide ? "page" : undefined}
            className={tabCls(!companyWide)}
          >
            This centre
          </Link>
          <Link
            href={registerHref(view, { period, from, to, scope: "company" })}
            aria-current={companyWide ? "page" : undefined}
            className={tabCls(companyWide)}
          >
            All centres
          </Link>
        </span>
      </div>

      {clamped && (
        <p className="text-debit text-[12px] mt-2">
          A range is limited to {MAX_RANGE_DAYS} days, so the start date was
          moved up. Use the Month or Year view to look further back.
        </p>
      )}

      {view === "day" || view === "range" ? (
        <TransactionsView
          companyId={company.id}
          centreId={centreId}
          from={from}
          to={to}
          showDate={view === "range"}
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

/**
 * Every individual transaction in [from, to] — one date for the Day view, an
 * arbitrary span for the Range view. Both render the same table; the Range view
 * additionally shows which date each row belongs to.
 */
async function TransactionsView({
  companyId,
  centreId,
  from,
  to,
  showDate,
  companyWide,
}: {
  companyId: string;
  centreId: string | null;
  from: Date;
  to: Date;
  showDate: boolean;
  companyWide: boolean;
}) {
  // Both queries take the same scope, so the tiles under the table are always
  // the totals of the table above them — no re-summing in JS.
  const [allRows, pl] = await Promise.all([
    getTransactionRegister(companyId, from, to, centreId),
    computeProfit(companyId, centreId, from, to),
  ]);

  // The totals below stay whole-range even when the list is trimmed — they come
  // from computeProfit, which aggregates in Postgres, not from the rows drawn.
  const truncated = allRows.length > MAX_RANGE_ROWS;
  const rows = truncated ? allRows.slice(0, MAX_RANGE_ROWS) : allRows;
  const cols = showDate ? 9 : 8;

  const { purchase, sale, expense, grossProfit: profit } = pl;

  // Settlements are money moving, not trade, so they are totalled separately
  // and deliberately left out of `profit` — counting a payment as a cost would
  // charge the same purchase twice. Summed over every row in the range, not
  // just the ones drawn, so a trimmed list still foots to the true figure.
  const settledOut = allRows
    .filter((r) => r.kind === "PAYMENT")
    .reduce((a, r) => a.add(r.amount), ZERO);
  const settledIn = allRows
    .filter((r) => r.kind === "RECEIPT")
    .reduce((a, r) => a.add(r.amount), ZERO);

  return (
    <>
      <div className="border border-line-strong bg-surface mb-5 mt-3 overflow-x-auto">
        <table className="ledger-table">
          <thead>
            <tr>
              {showDate && <th>Date</th>}
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
                <td colSpan={cols} className="text-muted text-[13px] px-4 py-3">
                  {showDate
                    ? "No transactions in this range."
                    : "No transactions on this date."}
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={`${r.kind}-${r.id}`}>
                  {showDate && (
                    <td className="whitespace-nowrap">{fmtDate(r.date)}</td>
                  )}
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
                <td colSpan={cols - 5} className="text-right">
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

      {truncated && (
        <p className="text-debit text-[12px] -mt-3 mb-4">
          Showing the first {MAX_RANGE_ROWS} of {allRows.length} transactions.
          The totals below cover the whole range — narrow the dates, or export
          the CSV, to see every row.
        </p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
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
    registerHref(bucket === "day" ? "day" : "month", {
      period: b.key,
      from,
      to,
      scope,
    });

  return (
    <>
      <div className="border border-line-strong bg-surface mb-5 mt-3 overflow-x-auto">
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
                    className={`num-col num font-semibold ${profitClass(b.grossProfit)}`}
                  >
                    {money(b.grossProfit)}
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
              <td className={`num-col num ${profitClass(total.grossProfit)}`}>
                {money(total.grossProfit)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Sale" value={total.sale} cls="text-credit" />
        <Stat label="Purchase" value={total.purchase} cls="text-debit" />
        <Stat label="Expense" value={total.expense} cls="text-debit" />
        <Stat
          label="Profit"
          value={total.grossProfit}
          cls={profitClass(total.grossProfit)}
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
