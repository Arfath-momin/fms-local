import { Prisma } from "@/generated/prisma/client";
import type { LedgerSourceType } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { getActiveScope } from "@/lib/centre";
import { fmtDate, fmtMoney } from "@/lib/format";
import { dateWhere, parseListWindow, type SearchParams } from "@/lib/paging";
import { VoucherDocument, sheetsFor, type Column } from "@/pdf/voucher-doc";
import { pdfFilename, pdfResponse } from "@/pdf/render";
import { letterheadFor } from "@/pdf/letterhead";

/**
 * A party's statement of account, as a downloadable PDF.
 *
 * The one document in the set that regularly leaves the building — what gets
 * handed to a boat owner or a buyer who disputes what they are owed. So it
 * prints the WHOLE window rather than one page of it: a statement missing rows
 * 51 onward is not a statement, and paging is the printer's business.
 *
 * The headline balance deliberately does not follow the window. It is what the
 * party owes NOW, which is the figure they will be asked to settle.
 */
const ZERO = new Prisma.Decimal(0);

const SOURCE_LABELS: Record<LedgerSourceType, string> = {
  PURCHASE: "Purchase",
  SALE: "Sale",
  EXPENSE: "Expense",
  PAYMENT: "Payment",
  RECEIPT: "Receipt",
  RENT: "Vehicle rent",
  RENT_BY_PARTY: "Rent paid to driver",
  // Retired — kept only so historic rows still render a name.
  COMMISSION: "Commission",
  RESERVE: "Reserve",
};

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  await requireSession();
  const { company, centre } = await getActiveScope();
  if (!centre) return new Response("No centre selected.", { status: 400 });
  const { id } = await params;

  const party = await prisma.party.findUnique({
    where: { id },
    select: { id: true, name: true, type: true },
  });
  if (!party) return new Response("Not found.", { status: 404 });

  const url = new URL(req.url);
  const listWindow = parseListWindow(
    Object.fromEntries(url.searchParams) as SearchParams
  );
  const scope = { companyId: company.id, centreId: centre.id, partyId: id };

  const [entries, latest] = await Promise.all([
    prisma.ledgerEntry.findMany({
      where: { ...scope, ...dateWhere(listWindow) },
      orderBy: [{ date: "asc" }, { seq: "asc" }],
    }),
    prisma.ledgerEntry.findFirst({
      where: scope,
      orderBy: [{ date: "desc" }, { seq: "desc" }],
      select: { runningBalance: true },
    }),
  ]);

  // What each row is FOR. "Sale ₹75,000" is not a statement line: a buyer
  // disputing it is holding a bill with a number on it, and a row they cannot
  // match to that number is a row they will query.
  const sourceIds = [...new Set(entries.map((e) => e.sourceId))];
  const [sales, purchases, expenses, settlements, trips] = await Promise.all([
    prisma.sale.findMany({ where: { id: { in: sourceIds } }, select: { id: true, billNo: true } }),
    prisma.purchase.findMany({ where: { id: { in: sourceIds } }, select: { id: true, billNo: true } }),
    prisma.expense.findMany({
      where: { id: { in: sourceIds } },
      select: { id: true, category: { select: { name: true } } },
    }),
    prisma.settlement.findMany({ where: { id: { in: sourceIds } }, select: { id: true, reference: true } }),
    prisma.deliveryNote.findMany({
      where: { id: { in: sourceIds } },
      select: { id: true, billNo: true, vehicle: { select: { number: true } } },
    }),
  ]);
  const detail = new Map<string, string>();
  for (const x of sales) if (x.billNo) detail.set(x.id, `Bill ${x.billNo}`);
  for (const x of purchases) if (x.billNo) detail.set(x.id, `Bill ${x.billNo}`);
  for (const x of expenses) detail.set(x.id, x.category.name);
  for (const x of settlements) if (x.reference) detail.set(x.id, x.reference);
  for (const x of trips) detail.set(x.id, `${x.billNo} · ${x.vehicle.number}`);

  // The balance before the window opened, worked back off its first row so the
  // statement starts from a real position rather than from zero.
  const first = entries[0];
  const opening = first
    ? first.runningBalance.sub(
        first.type === "DEBIT" ? first.amount : first.amount.negated()
      )
    : (latest?.runningBalance ?? ZERO);

  const columns: Column[] = [
    // Wide enough for "16 Aug 2026" on one line. At 58 it wrapped, putting the
    // year on a second line and pushing every row of a long statement taller.
    { label: "Date", width: 74 },
    { label: "Particulars", flex: 1 },
    { label: "Debit", width: 68, align: "right" },
    { label: "Credit", width: 68, align: "right" },
    { label: "Balance", width: 72, align: "right" },
  ];

  const rows: string[][] = [
    ["", "Opening balance", "", "", fmtMoney(opening)],
    ...entries.map((e) => {
      const d = detail.get(e.sourceId);
      return [
        fmtDate(e.date),
        d ? `${SOURCE_LABELS[e.sourceType]} · ${d}` : SOURCE_LABELS[e.sourceType],
        e.type === "DEBIT" ? fmtMoney(e.amount) : "",
        e.type === "CREDIT" ? fmtMoney(e.amount) : "",
        fmtMoney(e.runningBalance),
      ];
    }),
  ];

  const debits = entries
    .filter((e) => e.type === "DEBIT")
    .reduce((a, e) => a.add(e.amount), ZERO);
  const credits = entries
    .filter((e) => e.type === "CREDIT")
    .reduce((a, e) => a.add(e.amount), ZERO);
  const balance = latest?.runningBalance ?? ZERO;

  const letterhead = await letterheadFor(company.id);

  const doc = (
    <VoucherDocument
      d={{
        letterhead,
        centreName: centre.name,
        docKind: "Statement of Account",
        identity: [
          { label: "From", value: fmtDate(listWindow.fromDate) },
          { label: "To", value: fmtDate(listWindow.toDate) },
        ],
        partyTitle: "Statement for",
        partyName: party.name,
        partySub: null,
        details: [{ label: "Opening balance", value: fmtMoney(opening) }],
        columns,
        rows,
        totalRow: ["", "Total", fmtMoney(debits), fmtMoney(credits), ""],
        working: [
          {
            // Named, not left as a bare figure: a statement is read by somebody
            // who wants to know which way round the money goes.
            label: balance.greaterThan(0) ? "They owe us" : "We owe them",
            value: fmtMoney(balance.abs()),
            strong: true,
          },
        ],
        amountInWords: null,
        footNote:
          "Balance shown is the position as at today across all periods, not the closing balance of the window above.",
        notes: null,
        signLeft: null,
        signRight: `FOR ${company.name.toUpperCase()}`,
        lastItemPage: sheetsFor(rows.length),
      }}
    />
  );

  return pdfResponse(
    doc,
    pdfFilename(company.name, "statement", party.name, listWindow.to)
  );
}
