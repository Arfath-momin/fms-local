import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { getActiveScope } from "@/lib/centre";
import { fmtDate, fmtMoney } from "@/lib/format";
import { lineKgPerBox, lineTotalKg, sumDeliveryLines } from "@/lib/delivery";
import { PACK_LABELS } from "@/lib/pack";
import { VoucherDocument, sheetsFor, type Column } from "@/pdf/voucher-doc";
import { pdfFilename, pdfResponse } from "@/pdf/render";
import { letterheadFor } from "@/pdf/letterhead";

/**
 * A delivery note as a downloadable PDF — the copy that travels with the truck.
 *
 * It posts to no ledger and is not a bill, which the foot says plainly: a driver
 * handing this over should not be taken to be presenting an invoice.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  await requireSession();
  const { company, centre } = await getActiveScope();
  if (!centre) return new Response("No centre selected.", { status: 400 });
  const { id } = await params;

  const note = await prisma.deliveryNote.findFirst({
    where: { id, companyId: company.id, centreId: centre.id },
    include: {
      company: { select: { name: true } },
      centre: { select: { name: true } },
      vehicle: { select: { number: true, transporter: { select: { name: true } } } },
      lines: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }] },
    },
  });
  if (!note) return new Response("Not found.", { status: 404 });

  const totals = sumDeliveryLines(note.lines);
  const anyPcs = note.lines.some((l) => l.pcs > 0);

  const columns: Column[] = [
    { label: "Sl", width: 26, align: "right" },
    // Box, Big Box or Loose. The party takes delivery of the crates as well as
    // the fish, and a big box is twice the fish of an ordinary one.
    { label: "Pack", width: 48 },
    { label: "Particulars", flex: 1 },
    // Kg / box first, then Box — the order the merchant's own bills state it.
    { label: "Kg / box", width: 56, align: "right" },
    { label: "Box", width: 44, align: "right" },
    ...(anyPcs ? [{ label: "Pcs", width: 40, align: "right" as const }] : []),
    { label: "Total Kg", width: 66, align: "right" },
  ];

  const rows = note.lines.map((l, i) => [
    String(i + 1),
    PACK_LABELS[l.pack],
    l.particulars,
    // What ONE box weighs, worked back out of the row's weight — not the row's
    // own weight, which would read as fifty times the truth on a 50-box line.
    lineKgPerBox(l).toString(),
    l.box ? String(l.box) : "—",
    ...(anyPcs ? [l.pcs ? String(l.pcs) : "—"] : []),
    lineTotalKg(l).toString(),
  ]);

  const totalRow = [
    "",
    "",
    "Total",
    "",
    String(totals.box),
    ...(anyPcs ? [String(totals.pcs)] : []),
    totals.totalKg.toString(),
  ];

  const details: { label: string; value: string }[] = [
    { label: "Vehicle No.", value: note.vehicle.number },
    { label: "Transporter", value: note.vehicle.transporter.name },
  ];
  if (note.driverName) details.push({ label: "Driver", value: note.driverName });
  if (note.mobileNo) details.push({ label: "Mobile", value: note.mobileNo });
  if (note.advancePaid)
    details.push({ label: "Advance paid", value: fmtMoney(note.advancePaid) });

  const letterhead = await letterheadFor(note.companyId);

  const doc = (
    <VoucherDocument
      d={{
        letterhead,
        centreName: note.centre.name,
        docKind: "Delivery Note",
        identity: [
          { label: "No.", value: note.billNo },
          { label: "Date", value: fmtDate(note.date) },
        ],
        partyTitle: "Delivered to",
        partyName: note.recipient ?? "—",
        partySub: null,
        details,
        columns,
        rows,
        totalRow: rows.length > 0 ? totalRow : null,
        working: [],
        amountInWords: null,
        footNote:
          "A delivery note is a dispatch record only — it posts nothing to any ledger and is not a bill.",
        notes: null,
        signLeft: "DISPATCHED BY",
        signRight: "RECEIVED BY",
        lastItemPage: sheetsFor(rows.length),
      }}
    />
  );

  return pdfResponse(
    doc,
    pdfFilename(note.company.name, "delivery-note", note.billNo)
  );
}
