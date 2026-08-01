import { NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { getSession } from "@/lib/session";
import { getActiveCompany } from "@/lib/company";
import { getActiveCentre } from "@/lib/centre";
import {
  computePeriodBreakdown,
  computeProfit,
  getTransactionRegister,
} from "@/lib/report";
import { toInputDate } from "@/lib/format";

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
  const view = (sp.view === "day" || sp.view === "year" ? sp.view : "month") as
    | "day"
    | "month"
    | "year";

  // Get today's date — normally this would use businessTodayDate() but for CSV
  // export we just want the current UTC day. This is fine because export is
  // triggered by the user's explicit action.
  const today = new Date();

  if (view === "day") {
    const period = /^\d{4}-\d{2}-\d{2}$/.test(sp.period ?? "")
      ? sp.period!
      : today.toISOString().slice(0, 10);
    const d = new Date(`${period}T00:00:00.000Z`);
    return { view, period, from: d, to: d };
  }

  if (view === "year") {
    const period = /^\d{4}$/.test(sp.period ?? "")
      ? sp.period!
      : String(today.getUTCFullYear());
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
    : today.toISOString().slice(0, 7);
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
    const [rows, pl] = await Promise.all([
      getTransactionRegister(company.id, from, to, centreId),
      computeProfit(company.id, from, to),
    ]);

    const ZERO = new Prisma.Decimal(0);
    const sum = (kind: string) =>
      rows.filter((r) => r.kind === kind).reduce((a, r) => a.add(r.amount), ZERO);
    const purchase = companyWide ? pl.purchase : sum("PURCHASE");
    const sale = companyWide ? pl.sale : sum("SALE");
    const expense = companyWide ? pl.expense : sum("EXPENSE");
    const profit = sale.sub(purchase).sub(expense);

    const lines = [
      [
        "Centre",
        "Type",
        "Party",
        "Purchase",
        "Expense",
        "Sale",
      ].join(","),
      ...rows.map((r) =>
        [
          csvCell(r.centreName),
          csvCell(r.kind),
          csvCell(r.partyName),
          r.kind === "PURCHASE" ? formatValue(r.amount) : "",
          r.kind === "EXPENSE" ? formatValue(r.amount) : "",
          r.kind === "SALE" ? formatValue(r.amount) : "",
        ].join(",")
      ),
      "",
      ["Totals", "", "", formatValue(purchase), formatValue(expense), formatValue(sale)].join(
        ","
      ),
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
