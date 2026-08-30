import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { getActiveScope } from "@/lib/centre";
import { fmtDate, fmtKg, fmtMoney } from "@/lib/format";
import { rupeesInWords } from "@/lib/amount-words";
import { SALE_TYPE_LABELS, saleLineTotalKg } from "@/lib/sale";
import { PACK_LABELS } from "@/lib/pack";
import {
  VoucherDocument,
  sheetsFor,
  type Column,
  type WorkingRow,
} from "@/pdf/voucher-doc";
import { pdfFilename, pdfResponse } from "@/pdf/render";
import { letterheadFor } from "@/pdf/letterhead";

/**
 * A sale bill as a downloadable PDF — one click, no print dialog.
 *
 * `window.print()` cannot do this: browsers refuse to let a page choose "Save
 * as PDF" as the destination, since that would let any site write to your disk.
 *
 * All four channels, each printing what its own paper means. A MARKET bill is
 * itemised in boxes and priced as a net, so it has no Kgs or Rate column —
 * those would print zeros and invite the reader to multiply them.
 */
const ZERO = new Prisma.Decimal(0);
const gt0 = (v: Prisma.Decimal | null) => v != null && v.greaterThan(0);

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  await requireSession();
  const { company, centre } = await getActiveScope();
  if (!centre) return new Response("No centre selected.", { status: 400 });
  const { id } = await params;

  const sale = await prisma.sale.findFirst({
    // Scoped: a voucher belonging to another company or centre must not render.
    where: { id, companyId: company.id, centreId: centre.id },
    include: {
      company: { select: { name: true } },
      centre: { select: { name: true } },
      party: { select: { name: true } },
      careOfParty: { select: { name: true } },
      lines: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }] },
      deliveryNote: { select: { billNo: true, vehicle: { select: { number: true } } } },
    },
  });
  if (!sale) return new Response("Not found.", { status: 404 });

  const ledgerPartyId = sale.careOfPartyId ?? sale.partyId;
  const latest = await prisma.ledgerEntry.findFirst({
    where: { companyId: sale.companyId, centreId: sale.centreId, partyId: ledgerPartyId },
    orderBy: [{ date: "desc" }, { seq: "desc" }],
    select: { runningBalance: true },
  });
  const outstanding = latest?.runningBalance ?? ZERO;

  const isMarket = sale.type === "MARKET";
  const anyBox = sale.lines.some((l) => l.pack !== "LOOSE" && (l.box ?? 0) > 0);
  const anyPack = sale.lines.some((l) => l.pack !== "BOX");
  const totalBoxes = sale.lines.reduce(
    (a, l) => a + (l.pack === "LOOSE" ? 0 : (l.box ?? 0)),
    0
  );
  const totalKg = sale.lines.reduce(
    (a, l) => a + saleLineTotalKg({ qtyKg: Number(l.qtyKg), box: l.box }),
    0
  );

  // --- columns, and the rows built to match them exactly
  const columns: Column[] = [{ label: "Sr No", width: 34, align: "right" }];
  if (anyPack) columns.push({ label: "Pack", width: 48 });
  columns.push({ label: "Particulars", flex: 1 });
  if (anyBox) columns.push({ label: "Box", width: 44, align: "right" });
  if (!isMarket) {
    columns.push({ label: "Kgs", width: 62, align: "right" });
    columns.push({ label: "Rate/kg", width: 58, align: "right" });
    columns.push({ label: "Amount", width: 74, align: "right" });
  }

  const rows = sale.lines.map((l, i) => {
    const r = [String(i + 1)];
    if (anyPack) r.push(PACK_LABELS[l.pack]);
    r.push(l.particular);
    if (anyBox) r.push(l.pack === "LOOSE" ? "—" : String(l.box ?? 0));
    if (!isMarket) {
      r.push(fmtKg(saleLineTotalKg({ qtyKg: Number(l.qtyKg), box: l.box })));
      r.push(fmtMoney(l.ratePerKg));
      r.push(fmtMoney(l.total));
    }
    return r;
  });

  const totalRow: string[] = [""];
  if (anyPack) totalRow.push("");
  totalRow.push("Total");
  if (anyBox) totalRow.push(String(totalBoxes));
  if (!isMarket) {
    totalRow.push(fmtKg(totalKg));
    totalRow.push("");
    totalRow.push(fmtMoney(sale.amount));
  }

  // --- the working. A market bill shows every deduction, in the order the
  // market's own paper strikes them; the other channels are paid in full.
  const working: WorkingRow[] = [];
  if (isMarket && sale.totalBill) {
    working.push({ label: "Total bill", value: fmtMoney(sale.totalBill) });
    if (gt0(sale.commission))
      working.push({
        label: sale.commissionRate
          ? `Less commission (${sale.commissionRate}%)`
          : "Less commission",
        value: `−${fmtMoney(sale.commission!)}`,
      });
    if (gt0(sale.cutting))
      working.push({
        label: sale.cuttingRate
          ? `Less cutting (${sale.cuttingRate}%)`
          : "Less cutting",
        value: `−${fmtMoney(sale.cutting!)}`,
      });
    if (gt0(sale.reserve))
      working.push({
        label: "Less reserve (held)",
        value: `−${fmtMoney(sale.reserve!)}`,
      });
    if (gt0(sale.otherDeduction))
      working.push({
        label: "Less labour / other",
        value: `−${fmtMoney(sale.otherDeduction!)}`,
      });
    working.push({
      label: "Net bill",
      value: fmtMoney(sale.amount),
      rule: true,
      strong: true,
    });
    if (gt0(sale.rentDeducted)) {
      working.push({
        label: "Less receipt — paid the driver",
        value: `−${fmtMoney(sale.rentDeducted!)}`,
      });
      working.push({
        label: "Still owed on this bill",
        value: fmtMoney(sale.amount.sub(sale.rentDeducted!)),
        rule: true,
        strong: true,
      });
    }
  } else {
    working.push({
      label: "Bill amount",
      value: fmtMoney(sale.amount),
      strong: true,
    });
  }

  const details: { label: string; value: string }[] = [];
  if (sale.place) details.push({ label: "Place", value: sale.place });
  if (sale.placeOfLoading)
    details.push({ label: "Place of loading", value: sale.placeOfLoading });
  const vehicleNo = sale.deliveryNote?.vehicle.number ?? sale.vehicleNo;
  if (vehicleNo) details.push({ label: "Vehicle No.", value: vehicleNo });
  if (sale.deliveryNote?.billNo)
    details.push({ label: "Trip", value: sale.deliveryNote.billNo });
  if (sale.weight)
    details.push({ label: "Total weight", value: fmtKg(sale.weight) });
  // The same column under the name each trade gives it: a mill deducts for
  // water and ice, a factory hands kilos back.
  if (gt0(sale.waterLess))
    details.push({
      label: sale.type === "FACTORY" ? "Return" : "Water less",
      value: fmtKg(sale.waterLess!),
    });
  if (sale.netWeight)
    details.push({ label: "Net weight", value: fmtKg(sale.netWeight) });
  if (sale.totalBox) details.push({ label: "Total box", value: String(sale.totalBox) });

  const letterhead = await letterheadFor(sale.companyId);

  const doc = (
    <VoucherDocument
      d={{
        letterhead,
        centreName: sale.centre.name,
        docKind: `${SALE_TYPE_LABELS[sale.type]} Sale Bill`,
        identity: [
          { label: "No.", value: sale.billNo },
          { label: "Date", value: fmtDate(sale.saleDate ?? sale.date) },
          // Always, even when it matches. A reader seeing one date cannot tell
          // whether they agreed or whether the bill simply does not say.
          { label: "Purchase date", value: fmtDate(sale.date) },
        ],
        partyTitle: "Billed to",
        partyName: sale.party.name,
        partySub: sale.careOfParty ? `c/o ${sale.careOfParty.name}` : null,
        details,
        columns,
        rows,
        totalRow: rows.length > 0 ? totalRow : null,
        working,
        amountInWords: rupeesInWords(sale.amount),
        footNote: outstanding.greaterThan(0)
          ? `Total outstanding for ${(sale.careOfParty ?? sale.party).name} across all bills: ${fmtMoney(outstanding)}`
          : null,
        notes: sale.notes,
        signLeft: "RECEIVER'S SIGNATURE",
        signRight: `FOR ${sale.company.name.toUpperCase()}`,
        lastItemPage: sheetsFor(rows.length),
      }}
    />
  );

  return pdfResponse(
    doc,
    pdfFilename(sale.company.name, sale.type.toLowerCase(), sale.billNo)
  );
}
