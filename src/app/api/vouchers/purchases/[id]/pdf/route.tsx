import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { getActiveScope } from "@/lib/centre";
import { fmtDate, fmtKg, fmtMoney } from "@/lib/format";
import { rupeesInWords } from "@/lib/amount-words";
import {
  VoucherDocument,
  sheetsFor,
  type Column,
} from "@/pdf/voucher-doc";
import { pdfFilename, pdfResponse } from "@/pdf/render";
import { letterheadFor } from "@/pdf/letterhead";

/** A purchase voucher as a downloadable PDF. */
const ZERO = new Prisma.Decimal(0);

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  await requireSession();
  const { company, centre } = await getActiveScope();
  if (!centre) return new Response("No centre selected.", { status: 400 });
  const { id } = await params;

  const purchase = await prisma.purchase.findFirst({
    where: { id, companyId: company.id, centreId: centre.id },
    include: {
      company: { select: { name: true } },
      centre: { select: { name: true } },
      party: { select: { name: true } },
      lines: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }], include: { boat: { select: { name: true } } } },
    },
  });
  if (!purchase) return new Response("Not found.", { status: 404 });

  const latest = await prisma.ledgerEntry.findFirst({
    where: {
      companyId: purchase.companyId,
      centreId: purchase.centreId,
      partyId: purchase.partyId,
    },
    orderBy: [{ date: "desc" }, { seq: "desc" }],
    select: { runningBalance: true },
  });
  const outstanding = latest?.runningBalance ?? ZERO;

  // The boat is a Society or KFDC concern: it names where the fish came from,
  // while the money is owed to whoever sent it. Shown only when recorded.
  const anyBoat = purchase.lines.some((l) => l.boat);

  // Private and Local buy by the box and quote what one weighs; Society and
  // KFDC state their kilos outright.
  const anyBox = purchase.lines.some((l) => l.box > 0);

  const columns: Column[] = [{ label: "#", width: 26, align: "right" }];
  if (anyBoat) columns.push({ label: "Boat", width: 82 });
  columns.push({ label: "Particulars", flex: 1 });
  if (anyBox) {
    // Kg / Box first, then Box — the order the merchant's own bills state it.
    columns.push({ label: "Kg / Box", width: 54, align: "right" });
    columns.push({ label: "Box", width: 40, align: "right" });
  }
  columns.push({ label: "Total Kg", width: 68, align: "right" });
  columns.push({ label: "Rate/kg", width: 64, align: "right" });
  // Room for a lakh figure — a day's buying from a society reaches it easily.
  columns.push({ label: "Amount", width: 88, align: "right" });

  const rows = purchase.lines.map((l, i) => {
    const r = [String(i + 1)];
    if (anyBoat) r.push(l.boat?.name ?? "—");
    r.push(l.particular);
    if (anyBox) {
      // Worked back out of the row's weight, never stored beside it.
      r.push(
        l.box > 0
          ? new Prisma.Decimal(l.qtyKg).div(l.box).toDecimalPlaces(3).toString()
          : "—"
      );
      r.push(l.box ? String(l.box) : "—");
    }
    r.push(fmtKg(l.qtyKg));
    r.push(fmtMoney(l.pricePerKg));
    r.push(fmtMoney(l.total));
    return r;
  });

  const linesTotal = purchase.lines.reduce((a, l) => a.add(l.total), ZERO);
  const totalRow = [""];
  if (anyBoat) totalRow.push("");
  totalRow.push("Total");
  if (anyBox) {
    totalRow.push("", String(purchase.lines.reduce((a, l) => a + l.box, 0)));
  }
  totalRow.push(
    fmtKg(purchase.lines.reduce((a, l) => a.add(l.qtyKg), ZERO)),
    "",
    fmtMoney(linesTotal)
  );

  const letterhead = await letterheadFor(purchase.companyId);

  const doc = (
    <VoucherDocument
      d={{
        letterhead,
        centreName: purchase.centre.name,
        docKind: "Purchase Voucher",
        identity: [
          ...(purchase.billNo
            ? [{ label: "No.", value: purchase.billNo }]
            : []),
          { label: "Date", value: fmtDate(purchase.date) },
        ],
        partyTitle: "Bought from",
        partyName: purchase.party.name,
        partySub: null,
        details: [{ label: "Centre", value: purchase.centre.name }],
        columns,
        rows,
        totalRow: rows.length > 0 ? totalRow : null,
        working: [
          {
            label: "Purchase amount",
            value: fmtMoney(purchase.amount),
            strong: true,
          },
          {
            // A purchase party is normally a creditor: the sign says which way
            // round, rather than leaving a bare figure to be read either way.
            label: outstanding.greaterThan(0) ? "They owe us" : "We owe them",
            value: fmtMoney(outstanding.abs()),
            rule: true,
          },
        ],
        amountInWords: rupeesInWords(purchase.amount),
        footNote: null,
        notes: purchase.notes,
        signLeft: "RECEIVED BY",
        signRight: `FOR ${purchase.company.name.toUpperCase()}`,
        lastItemPage: sheetsFor(rows.length),
      }}
    />
  );

  return pdfResponse(
    doc,
    pdfFilename(purchase.company.name, "purchase", purchase.billNo ?? fmtDate(purchase.date))
  );
}
