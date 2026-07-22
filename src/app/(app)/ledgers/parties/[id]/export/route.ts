import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { getActiveCompany } from "@/lib/company";

const SOURCE_LABELS: Record<string, string> = {
  PURCHASE: "Purchase",
  SALE: "Sale",
  EXPENSE: "Expense",
  PAYMENT: "Payment",
};

function csvCell(v: string) {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
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
  const [party, company] = await Promise.all([
    prisma.party.findUnique({ where: { id } }),
    getActiveCompany(),
  ]);
  if (!party) return new NextResponse("Not found", { status: 404 });

  const entries = await prisma.ledgerEntry.findMany({
    where: { companyId: company.id, partyId: id },
    orderBy: [{ date: "asc" }, { createdAt: "asc" }],
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

  const filename = `${company.name}-${party.name.replace(/[^\w-]+/g, "_")}-statement.csv`;
  return new NextResponse(lines.join("\r\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
