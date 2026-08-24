import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { getActiveScope } from "@/lib/centre";

const SOURCE_LABELS: Record<string, string> = {
  PURCHASE: "Purchase",
  SALE: "Sale",
  EXPENSE: "Expense",
  PAYMENT: "Payment",
};

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
function csvCell(v: string): string {
  const defused = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\n\r]/.test(defused)
    ? `"${defused.replace(/"/g, '""')}"`
    : defused;
}

/** A filename part that cannot escape the quoted Content-Disposition header. */
function safeName(v: string): string {
  return v.replace(/[^\w-]+/g, "_");
}

// Statement CSV — generated in-memory and streamed, never persisted
// server-side (spec §1 file-storage rule).
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return new NextResponse("Unauthorized", { status: 401 });

  const { id } = await params;
  const [party, scope] = await Promise.all([
    prisma.party.findUnique({ where: { id } }),
    getActiveScope(),
  ]);
  if (!party) return new NextResponse("Not found", { status: 404 });
  const { company, centre } = scope;
  if (!centre) return new NextResponse("No centre selected", { status: 400 });

  const entries = await prisma.ledgerEntry.findMany({
    where: { companyId: company.id, centreId: centre.id, partyId: id },
    orderBy: [{ date: "asc" }, { seq: "asc" }],
  });

  const lines = [
    ["Date", "Particulars", "Debit", "Credit", "Balance"].join(","),
    ...entries.map((e) =>
      [
        e.date.toISOString().slice(0, 10),
        csvCell(SOURCE_LABELS[e.sourceType] ?? e.sourceType),
        e.type === "DEBIT" ? e.amount.toString() : "",
        e.type === "CREDIT" ? e.amount.toString() : "",
        e.runningBalance.toString(),
      ].join(",")
    ),
  ];

  // Every part sanitised, the company included — it was the one name passed
  // through raw, and a quote in it would have broken out of the quoted
  // filename in the Content-Disposition header below.
  const filename =
    [company.name, centre.name, party.name].map(safeName).join("-") +
    "-statement.csv";
  return new NextResponse(lines.join("\r\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
