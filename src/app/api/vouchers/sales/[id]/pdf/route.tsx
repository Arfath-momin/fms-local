import { renderToBuffer } from "@react-pdf/renderer";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { getActiveScope } from "@/lib/centre";
import { fmtDate, fmtMoney } from "@/lib/format";
import { rupeesInWords } from "@/lib/amount-words";
import { MarketBillDocument, type MarketBillData } from "@/pdf/market-bill";

/**
 * A sale bill as a downloadable PDF.
 *
 * An API route rather than a page because a browser needs a URL it can be sent
 * to — one click, a file, no print dialog. `window.print()` cannot do this:
 * browsers deliberately refuse to let a page choose "Save as PDF" as the
 * destination, since that would let any site write to your disk.
 *
 * Renders one at a time. The server has a single core shared with Postgres, and
 * two bills generated at once would have them competing for it while somebody
 * else is trying to save a voucher. A bill takes well under a second, so a
 * queue of two or three is not felt.
 *
 * MARKET ONLY for now, deliberately. This is the first document built this way;
 * the other channels keep the HTML print page until this one has been read on
 * paper and judged.
 */

let queue: Promise<unknown> = Promise.resolve();
/** Run `fn` after whatever is already rendering, whether it succeeded or not. */
function serialise<T>(fn: () => Promise<T>): Promise<T> {
  const next = queue.then(fn, fn);
  // The chain must not inherit a rejection, or one failed bill would stop every
  // bill after it.
  queue = next.then(
    () => undefined,
    () => undefined
  );
  return next;
}

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
    // Scoped, exactly as the print page is: a voucher belonging to another
    // company or centre must not render, let alone download.
    where: { id, companyId: company.id, centreId: centre.id },
    include: {
      company: { select: { name: true } },
      centre: { select: { name: true } },
      party: { select: { id: true, name: true } },
      careOfParty: { select: { id: true, name: true } },
      lines: { orderBy: { id: "asc" } },
      deliveryNote: { select: { vehicle: { select: { number: true } } } },
    },
  });
  if (!sale) return new Response("Not found.", { status: 404 });
  if (sale.type !== "MARKET")
    return new Response(
      "Only market bills are generated this way so far.",
      { status: 400 }
    );

  const ledgerPartyId = sale.careOfPartyId ?? sale.partyId;
  const latest = await prisma.ledgerEntry.findFirst({
    where: { companyId: sale.companyId, centreId: sale.centreId, partyId: ledgerPartyId },
    orderBy: [{ date: "desc" }, { seq: "desc" }],
    select: { runningBalance: true },
  });
  const outstanding = latest?.runningBalance ?? ZERO;

  const details: { label: string; value: string }[] = [];
  if (sale.place) details.push({ label: "Place", value: sale.place });
  const vehicleNo = sale.deliveryNote?.vehicle.number ?? sale.vehicleNo;
  if (vehicleNo) details.push({ label: "Vehicle No.", value: vehicleNo });

  // The deductions, each named for what it is and only when it was struck.
  const working: { label: string; value: string }[] = [
    { label: "Total bill", value: fmtMoney(sale.totalBill ?? ZERO) },
  ];
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

  const data: MarketBillData = {
    companyName: sale.company.name,
    centreName: sale.centre.name,
    billNo: sale.billNo,
    saleDate: fmtDate(sale.saleDate ?? sale.date),
    purchaseDate: fmtDate(sale.date),
    partyName: sale.party.name,
    careOfName: sale.careOfParty?.name ?? null,
    details,
    lines: sale.lines.map((l) => ({
      particular: l.particular,
      // A LOOSE row never went into a crate, so it carries no box count.
      box: l.pack === "LOOSE" ? "—" : String(l.box ?? 0),
    })),
    totalBoxes: String(
      sale.lines.reduce(
        (a, l) => a + (l.pack === "LOOSE" ? 0 : (l.box ?? 0)),
        0
      )
    ),
    working,
    netBill: fmtMoney(sale.amount),
    receipt: gt0(sale.rentDeducted)
      ? {
          label: "Less receipt — paid the driver",
          value: `−${fmtMoney(sale.rentDeducted!)}`,
          owed: fmtMoney(sale.amount.sub(sale.rentDeducted!)),
        }
      : null,
    // How many rows an A4 sheet holds once the head and the "billed to" block
    // are down. Measured, not guessed: 35 on the first sheet and 36 on each
    // after it. The divisor is deliberately LOWER than that, because the two
    // ways of being wrong are not equally bad — over-estimating leaves a column
    // heading on a sheet with no rows under it, which is untidy, while
    // under-estimating drops the headings from a sheet that HAS rows, which
    // leaves a reader guessing which column is which. Neither moves a figure.
    lastItemPage: Math.max(1, Math.ceil(sale.lines.length / 34)),
    amountInWords: rupeesInWords(sale.amount),
    outstanding: outstanding.greaterThan(0) ? fmtMoney(outstanding) : null,
    notes: sale.notes,
  };

  const pdf = await serialise(() =>
    renderToBuffer(<MarketBillDocument d={data} />)
  );

  // A filename the merchant can find again in a folder of fifty. Anything the
  // filesystem or the header grammar dislikes is stripped rather than escaped.
  const safe = `${sale.company.name}-market-${sale.billNo}`
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${safe}.pdf"`,
      // A bill can be corrected; a cached copy of the old one is worse than a
      // second's wait.
      "Cache-Control": "no-store",
    },
  });
}
