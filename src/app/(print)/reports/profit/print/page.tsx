import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireReports } from "@/lib/session";
import { getActiveScope } from "@/lib/centre";
import { computeProfit } from "@/lib/report";
import { PURCHASE_TYPE_LABELS } from "@/lib/purchase";
import { SALE_TYPE_LABELS } from "@/lib/sale";
import { businessTodayDate, fmtDate, fmtMoney, toInputDate } from "@/lib/format";
import { PrintHeader } from "../../../letterhead";
import { PrintToolbar } from "../../../print-toolbar";
import "../../../voucher-print.css";

function monthStart(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

/**
 * The profit and loss account as a document.
 *
 * Reads the same `from`/`to` query string as the screen and defaults it the
 * same way, so "Print" always covers the period that was on display rather than
 * a similar-looking default.
 *
 * Broken out by category rather than printing four headline figures: a P/L
 * anyone is expected to act on has to show which purchase types and which
 * expense heads made it, or the only possible response to a bad month is a
 * shrug.
 */
export default async function ProfitPrintPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  await requireReports();
  const { company, centre } = await getActiveScope();
  if (!centre) notFound();

  const letterhead = await prisma.company.findUnique({
    where: { id: company.id },
    select: {
      id: true, name: true, legalName: true, address: true,
      phone: true, email: true, gstin: true, colour: true, logoKey: true,
    },
  });
  if (!letterhead) notFound();

  const sp = await searchParams;
  const today = businessTodayDate();
  const from =
    sp.from && /^\d{4}-\d{2}-\d{2}$/.test(sp.from)
      ? new Date(sp.from)
      : monthStart(today);
  const to =
    sp.to && /^\d{4}-\d{2}-\d{2}$/.test(sp.to) ? new Date(sp.to) : today;

  const r = await computeProfit(company.id, centre.id, from, to);
  const isProfit = r.grossProfit.greaterThanOrEqualTo(0);

  return (
    <div
      className="bill-sheet"
      data-company={letterhead.name}
      style={
        letterhead.colour
          ? ({ "--company": letterhead.colour } as React.CSSProperties)
          : undefined
      }
    >
      <PrintToolbar
        backHref={`/reports/profit?from=${toInputDate(from)}&to=${toInputDate(to)}`}
        backLabel="Back to the report"
      />

      <div className="bill-paper">
        <PrintHeader
          company={letterhead}
          centreName={centre.name}
          docKind="Profit & Loss"
          right={
            <>
              <div className="num text-[13px]">
                <span className="opacity-75">From </span>
                <span className="font-semibold">{fmtDate(from)}</span>
              </div>
              <div className="num text-[13px]">
                <span className="opacity-75">To </span>
                <span className="font-semibold">{fmtDate(to)}</span>
              </div>
            </>
          }
        />

        <Section
          title="Sales"
          rows={r.saleByType.map((x) => ({
            label: SALE_TYPE_LABELS[x.type],
            amount: x.amount,
          }))}
          total={r.sale}
        />

        <Section
          title="Purchases"
          rows={r.purchaseByType.map((x) => ({
            label: PURCHASE_TYPE_LABELS[x.type],
            amount: x.amount,
          }))}
          total={r.purchase}
        />

        <Section
          title="Expenses"
          rows={r.expenseByCategory.map((x) => ({
            label: x.name,
            amount: x.amount,
          }))}
          total={r.expense}
        />

        {/* Profit = Sale − (Purchase + Expense). Settlements are deliberately
            absent: paying for a purchase moves a balance, never the profit, and
            counting one here would charge the same cost twice. */}
        <table className="bill-table mt-4">
          <tbody>
            <tr>
              <td className="font-semibold">Total sales</td>
              <td className="r num font-semibold">{fmtMoney(r.sale)}</td>
            </tr>
            <tr>
              <td>Less purchases</td>
              <td className="r num">{fmtMoney(r.purchase)}</td>
            </tr>
            <tr>
              <td>Less expenses</td>
              <td className="r num">{fmtMoney(r.expense)}</td>
            </tr>
          </tbody>
          <tfoot>
            <tr>
              <td className="font-semibold">
                {isProfit ? "Net profit" : "Net loss"}
              </td>
              <td className="r num font-semibold">
                {fmtMoney(r.grossProfit.abs())}
              </td>
            </tr>
          </tfoot>
        </table>

        <p className="text-[11px] text-muted mt-3">
          Profit is sales less purchases and expenses for the period shown.
          Payment status is not considered — an unpaid purchase is still a cost
          of this period, and settling one moves a party&rsquo;s balance rather
          than this figure. Vouchers flagged as errors are excluded.
        </p>

        <div className="bill-sign">
          <div>Checked by</div>
          <div>For {letterhead.legalName ?? letterhead.name}</div>
        </div>
      </div>
    </div>
  );
}

function Section({
  title,
  rows,
  total,
}: {
  title: string;
  rows: { label: string; amount: import("@/generated/prisma/client").Prisma.Decimal }[];
  total: import("@/generated/prisma/client").Prisma.Decimal;
}) {
  return (
    <table className="bill-table mt-4">
      <thead>
        <tr>
          <th>{title}</th>
          <th className="r">Amount</th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr>
            <td className="text-muted">None in this period</td>
            <td className="r num">{fmtMoney(0)}</td>
          </tr>
        ) : (
          rows.map((x) => (
            <tr key={x.label}>
              <td>{x.label}</td>
              <td className="r num">{fmtMoney(x.amount)}</td>
            </tr>
          ))
        )}
      </tbody>
      <tfoot>
        <tr>
          <td>Total {title.toLowerCase()}</td>
          <td className="r num">{fmtMoney(total)}</td>
        </tr>
      </tfoot>
    </table>
  );
}
