import { Prisma } from "@/generated/prisma/client";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireReports } from "@/lib/session";
import { getActiveScope } from "@/lib/centre";
import { computeProfit, getTransactionRegister } from "@/lib/report";
import {
  parseRegisterPeriod,
  type RegisterParams,
} from "@/lib/register-period";
import {
  REGISTER_KIND_LABELS,
  registerSubtypeLabel,
} from "@/lib/register-labels";
import { fmtDate, fmtMoney, toInputDate } from "@/lib/format";
import { PrintHeader } from "../../../letterhead";
import { PrintToolbar } from "../../../print-toolbar";
import "../../../voucher-print.css";

const ZERO = new Prisma.Decimal(0);

/**
 * The transactions register as a document — the CSV's counterpart for anyone
 * who wants the period on paper rather than in a spreadsheet.
 *
 * It reads the SAME query string as the on-screen report and parses it with the
 * same module, so "Print" always covers the window that was on screen rather
 * than a default period that happens to look similar. Rows and labels come from
 * the same helpers too (@/lib/register-labels), so the sheet cannot disagree
 * with the screen it was taken from.
 *
 * Deliberately NOT capped the way the screen is. The screen trims a long range
 * because scrolling thousands of rows is useless; a print-out of a long range
 * is the one case where you actually do want every line, and paging is the
 * printer's job.
 */
export default async function RegisterPrintPage({
  searchParams,
}: {
  searchParams: Promise<RegisterParams>;
}) {
  await requireReports();
  const { company, centre } = await getActiveScope();

  const sp = await searchParams;
  const { view, period, from, to, label } = parseRegisterPeriod(sp);

  // Same default as the report: centre-scoped unless asked otherwise. With no
  // centre at all there is nothing to narrow to, so it falls back to
  // company-wide rather than refusing to render.
  const companyWide = sp.scope === "company" || !centre;
  const centreId = companyWide ? null : centre!.id;

  // getActiveScope() returns the slim CompanyInfo the app chrome needs; the
  // letterhead wants the full postal identity, so it is read here rather than
  // widening CompanyInfo and making every page carry fields only paper uses.
  const [letterhead, rows, pl] = await Promise.all([
    prisma.company.findUnique({
      where: { id: company.id },
      select: {
        id: true, name: true, legalName: true, address: true,
        phone: true, email: true, gstin: true, colour: true, logoKey: true,
      },
    }),
    getTransactionRegister(company.id, from, to, centreId),
    computeProfit(company.id, centreId, from, to),
  ]);
  if (!letterhead) notFound();

  // Settlements are money moving, not trade: totalled separately and kept out
  // of profit, or settling a purchase would charge the same cost twice.
  const settledOut = rows
    .filter((r) => r.kind === "PAYMENT")
    .reduce((a, r) => a.add(r.amount), ZERO);
  const settledIn = rows
    .filter((r) => r.kind === "RECEIPT")
    .reduce((a, r) => a.add(r.amount), ZERO);

  // Preserves the exact window so "back" returns to the report as it was.
  const backParams = new URLSearchParams();
  backParams.set("view", view);
  backParams.set("scope", companyWide ? "company" : "centre");
  if (view === "range") {
    backParams.set("from", toInputDate(from));
    backParams.set("to", toInputDate(to));
  } else {
    backParams.set("period", period);
  }

  return (
    <div
      className="bill-sheet"
      data-company={company.name}
      style={
        company.colour
          ? ({ "--company": company.colour } as React.CSSProperties)
          : undefined
      }
    >
      <PrintToolbar
        backHref={`/reports/register?${backParams}`}
        backLabel="Back to the report"
      />

      <div className="bill-paper">
        <PrintHeader
          company={letterhead}
          centreName={companyWide ? "All centres" : centre!.name}
          docKind="Transactions"
          right={
            <>
              <div className="num text-[13px]">
                <span className="font-semibold">{label}</span>
              </div>
              <div className="num text-[12px] opacity-75">
                {fmtDate(from)} — {fmtDate(to)}
              </div>
            </>
          }
        />

        {rows.length === 0 ? (
          <p className="text-[13px] text-muted py-6">
            No transactions in this period.
          </p>
        ) : (
          <table className="bill-table">
            <thead>
              <tr>
                <th className="w-20">Date</th>
                {companyWide && <th>Centre</th>}
                <th>Type</th>
                <th>Party</th>
                <th className="r">Purchase</th>
                <th className="r">Expense</th>
                <th className="r">Sale</th>
                <th className="r">Paid</th>
                <th className="r">Received</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.kind}-${r.id}`}>
                  <td className="num">{fmtDate(r.date)}</td>
                  {companyWide && <td>{r.centreName}</td>}
                  <td>
                    {REGISTER_KIND_LABELS[r.kind]} ·{" "}
                    {registerSubtypeLabel(r.kind, r.subtype)}
                  </td>
                  <td>{r.partyName}</td>
                  <td className="r num">
                    {r.kind === "PURCHASE" ? fmtMoney(r.amount) : ""}
                  </td>
                  <td className="r num">
                    {r.kind === "EXPENSE" ? fmtMoney(r.amount) : ""}
                  </td>
                  <td className="r num">
                    {r.kind === "SALE" ? fmtMoney(r.amount) : ""}
                  </td>
                  <td className="r num">
                    {r.kind === "PAYMENT" ? fmtMoney(r.amount) : ""}
                  </td>
                  <td className="r num">
                    {r.kind === "RECEIPT" ? fmtMoney(r.amount) : ""}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={companyWide ? 4 : 3}>Total</td>
                <td className="r num">{fmtMoney(pl.purchase)}</td>
                <td className="r num">{fmtMoney(pl.expense)}</td>
                <td className="r num">{fmtMoney(pl.sale)}</td>
                <td className="r num">{fmtMoney(settledOut)}</td>
                <td className="r num">{fmtMoney(settledIn)}</td>
              </tr>
            </tfoot>
          </table>
        )}

        <div className="grid grid-cols-2 gap-6 mt-4 text-[12px]">
          <div className="grid gap-0.5">
            <Detail label="Purchases" value={fmtMoney(pl.purchase)} />
            <Detail label="Expenses" value={fmtMoney(pl.expense)} />
            <Detail label="Sales" value={fmtMoney(pl.sale)} />
          </div>
          <div className="grid gap-0.5">
            <Detail
              label={pl.grossProfit.greaterThanOrEqualTo(0) ? "Profit" : "Loss"}
              value={fmtMoney(pl.grossProfit.abs())}
            />
            <Detail label="Paid out" value={fmtMoney(settledOut)} />
            <Detail label="Received" value={fmtMoney(settledIn)} />
          </div>
        </div>

        {/* The same caveat the screen carries. Profit is only strictly
            meaningful company-wide, because a purchase and the sale of the
            same fish can sit in different centres. */}
        {!companyWide && (
          <p className="text-[11px] text-muted mt-3">
            Centre-scoped. Profit is only strictly meaningful company-wide — a
            purchase and the sale of the same fish can sit in different centres.
          </p>
        )}
      </div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
