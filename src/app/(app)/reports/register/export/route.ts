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
import { businessToday, toInputDate } from "@/lib/format";

type SearchParams = { view?: string; period?: string; scope?: string };

function csvCell(v: string): string {
  if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

function formatValue(v: Prisma.Decimal | string | number): string {
  if (v instanceof Prisma.Decimal) return v.toString();
  if (typeof v === "number") return String(v);
  return String(v);
}

async function parsePeriod(sp: SearchParams): Promise<{
  view: "day" | "month" | "year";
  from: Date;
  to: Date;
  period: string;
}> {
  // Mirrors the screen's default so an export taken straight after opening
  // the report covers the same period the user was looking at.
  const view = (sp.view === "month" || sp.view === "year" ? sp.view : "day") as
    | "day"
    | "month"
    | "year";

  // India time, like every other "today" in the app. UTC is a day behind
  // between midnight and 05:30 IST, so using it here would export a different
  // day from the one the report on screen is showing.
  const today = businessToday();

  if (view === "day") {
    const period = /^\d{4}-\d{2}-\d{2}$/.test(sp.period ?? "")
      ? sp.period!
      : today;
    const d = new Date(`${period}T00:00:00.000Z`);
    return { view, period, from: d, to: d };
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
    };
  }

  const period = /^\d{4}-\d{2}$/.test(sp.period ?? "")
    ? sp.period!
    : today.slice(0, 7);
  const [y, m] = period.split("-").map(Number);
  return {
    view,
    period,
    from: new Date(Date.UTC(y, m - 1, 1)),
    to: new Date(Date.UTC(y, m, 0)),
  };
}

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return new NextResponse("Unauthorized", { status: 401 });
  // A route handler is a public URL, so it repeats the page's permission check
  // rather than relying on the export link being hidden from the UI.
  if (!canViewReports(session.role))
    return new NextResponse("Forbidden", { status: 403 });

  const url = new URL(req.url);
  const sp: SearchParams = {
    view: url.searchParams.get("view") ?? undefined,
    period: url.searchParams.get("period") ?? undefined,
    scope: url.searchParams.get("scope") ?? undefined,
  };

  const company = await getActiveCompany();
  const centre = await getActiveCentre(company.id);

  if (!centre) return new NextResponse("No centre selected", { status: 400 });

  const { view, from, to, period } = await parsePeriod(sp);
  const companyWide = sp.scope === "company";
  const centreId = companyWide ? null : centre.id;

  let csv: string;
  let filename: string;

  if (view === "day") {
    // Both queries share one scope, so the totals row always matches the rows
    // above it — no re-summing in JS.
    const [rows, pl] = await Promise.all([
      getTransactionRegister(company.id, from, to, centreId),
      computeProfit(company.id, centreId, from, to),
    ]);

    const { purchase, sale, expense, profit } = pl;

    // Same split as the screen: settlements are totalled on their own and kept
    // out of profit, so the CSV can never disagree with the report it came from.
    const ZERO = new Prisma.Decimal(0);
    const settledOut = rows
      .filter((r) => r.kind === "PAYMENT")
      .reduce((a, r) => a.add(r.amount), ZERO);
    const settledIn = rows
      .filter((r) => r.kind === "RECEIPT")
      .reduce((a, r) => a.add(r.amount), ZERO);

    const lines = [
      [
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
        formatValue(purchase),
        formatValue(expense),
        formatValue(sale),
        formatValue(settledOut),
        formatValue(settledIn),
      ].join(","),
      ["Profit/Loss", "", "", "", "", formatValue(profit)].join(","),
    ];
    csv = lines.join("\r\n");
    filename = `${company.name}-transactions-${toInputDate(from)}.csv`;
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
          formatValue(b.profit),
        ].join(",")
      ),
      "",
      [
        "Total",
        formatValue(total.purchase),
        formatValue(total.expense),
        formatValue(total.sale),
        formatValue(total.profit),
      ].join(","),
    ];
    csv = lines.join("\r\n");
    filename = `${company.name}-${view}-report-${period}.csv`;
  }

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
