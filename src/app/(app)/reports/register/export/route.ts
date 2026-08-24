import { NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { canViewReports, getSession } from "@/lib/session";
import { getActiveCompany } from "@/lib/company";
import { getActiveCentre } from "@/lib/centre";
import {
  computePeriodBreakdown,
  computeProfit,
  getTransactionRegister,
} from "@/lib/report";
import { fmtDate, toInputDate } from "@/lib/format";
import { parseRegisterPeriod } from "@/lib/register-period";

/**
 * One CSV field, quoted where the format requires it and neutralised where a
 * spreadsheet would otherwise run it.
 *
 * Excel, LibreOffice and Sheets all treat a leading =, +, - or @ as the start of
 * a formula, so a party recorded as `=HYPERLINK(...)` — and party names are
 * typed by whoever enters a voucher — becomes live content in the accountant's
 * spreadsheet rather than a name. A leading apostrophe is the standard
 * defusing: the cell still reads as the plain text it should be.
 *
 * Tab and carriage return are included because both can carry the payload past
 * a naive check and still be seen by the parser.
 */
/** A filename part that cannot escape the quoted Content-Disposition header. */
function safeName(v: string): string {
  return v.replace(/[^\w-]+/g, "_");
}

function csvCell(v: string): string {
  const defused = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\n\r]/.test(defused)
    ? `"${defused.replace(/"/g, '""')}"`
    : defused;
}

function formatValue(v: Prisma.Decimal | string | number): string {
  if (v instanceof Prisma.Decimal) return v.toString();
  if (typeof v === "number") return String(v);
  return String(v);
}

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return new NextResponse("Unauthorized", { status: 401 });
  // A route handler is a public URL, so it repeats the page's permission check
  // rather than relying on the export link being hidden from the UI.
  if (!canViewReports(session.role))
    return new NextResponse("Forbidden", { status: 403 });

  const url = new URL(req.url);
  const get = (k: string) => url.searchParams.get(k) ?? undefined;
  const scope = get("scope");

  const company = await getActiveCompany();
  const centre = await getActiveCentre(company.id);

  if (!centre) return new NextResponse("No centre selected", { status: 400 });

  // Parsed by the same module the screen uses, so an export taken straight
  // after opening the report always covers the window that was on screen.
  const { view, from, to, period } = parseRegisterPeriod({
    view: get("view"),
    period: get("period"),
    from: get("from"),
    to: get("to"),
    scope,
  });
  const companyWide = scope === "company";
  const centreId = companyWide ? null : centre.id;

  let csv: string;
  let filename: string;

  if (view === "day" || view === "range") {
    // Both queries share one scope, so the totals row always matches the rows
    // above it — no re-summing in JS.
    const [rows, pl] = await Promise.all([
      getTransactionRegister(company.id, from, to, centreId),
      computeProfit(company.id, centreId, from, to),
    ]);

    const { purchase, sale, expense, grossProfit: profit } = pl;

    // Same split as the screen: settlements are totalled on their own and kept
    // out of profit, so the CSV can never disagree with the report it came from.
    const ZERO = new Prisma.Decimal(0);
    const settledOut = rows
      .filter((r) => r.kind === "PAYMENT")
      .reduce((a, r) => a.add(r.amount), ZERO);
    const settledIn = rows
      .filter((r) => r.kind === "RECEIPT")
      .reduce((a, r) => a.add(r.amount), ZERO);

    // The export is never trimmed the way the screen is — a CSV exists to hold
    // every row, which is what the on-screen notice points people here for.
    const lines = [
      [
        "Date",
        "Centre",
        "Type",
        "Party",
        "Purchase",
        "Expense",
        "Sale",
        "Paid",
        "Received",
      ].join(","),
      ...rows.map((r) =>
        [
          csvCell(fmtDate(r.date)),
          csvCell(r.centreName),
          csvCell(r.kind),
          csvCell(r.partyName),
          r.kind === "PURCHASE" ? formatValue(r.amount) : "",
          r.kind === "EXPENSE" ? formatValue(r.amount) : "",
          r.kind === "SALE" ? formatValue(r.amount) : "",
          r.kind === "PAYMENT" ? formatValue(r.amount) : "",
          r.kind === "RECEIPT" ? formatValue(r.amount) : "",
        ].join(",")
      ),
      "",
      [
        "Totals",
        "",
        "",
        "",
        formatValue(purchase),
        formatValue(expense),
        formatValue(sale),
        formatValue(settledOut),
        formatValue(settledIn),
      ].join(","),
      ["Profit/Loss", "", "", "", "", "", formatValue(profit)].join(","),
    ];
    csv = lines.join("\r\n");
    filename =
      view === "range"
        ? `${safeName(company.name)}-transactions-${toInputDate(from)}-to-${toInputDate(to)}.csv`
        : `${safeName(company.name)}-transactions-${toInputDate(from)}.csv`;
  } else {
    const { buckets, total } = await computePeriodBreakdown({
      companyId: company.id,
      centreId,
      from,
      to,
      bucket: view === "month" ? "day" : "month",
    });

    const lines = [
      [
        view === "month" ? "Day" : "Month",
        "Purchase",
        "Expense",
        "Sale",
        "Profit/Loss",
      ].join(","),
      ...buckets.map((b) =>
        [
          csvCell(b.label),
          formatValue(b.purchase),
          formatValue(b.expense),
          formatValue(b.sale),
          formatValue(b.grossProfit),
        ].join(",")
      ),
      "",
      [
        "Total",
        formatValue(total.purchase),
        formatValue(total.expense),
        formatValue(total.sale),
        formatValue(total.grossProfit),
      ].join(","),
    ];
    csv = lines.join("\r\n");
    filename = `${safeName(company.name)}-${view}-report-${period}.csv`;
  }

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
