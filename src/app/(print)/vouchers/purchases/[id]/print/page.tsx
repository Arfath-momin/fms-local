import { notFound } from "next/navigation";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { getActiveScope } from "@/lib/centre";
import { requireSession } from "@/lib/session";
import { PURCHASE_TYPE_LABELS } from "@/lib/purchase";
import { purchaseHasLineBoats,
  purchaseHasLineBoxes } from "@/lib/party";
import { fmtDate, fmtKg, fmtMoney } from "@/lib/format";
import { rupeesInWords } from "@/lib/amount-words";
import { docTitle, titleDate } from "@/lib/doc-title";
import { PrintHeader } from "../../../../letterhead";
import { PrintToolbar } from "../../../../print-toolbar";
import "../../../../voucher-print.css";

/** The filename this bill saves itself as — see src/lib/doc-title.ts. */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { company, centre } = await getActiveScope();
  if (!centre) return { title: "FMS" };
  const purchase = await prisma.purchase.findFirst({
    where: { id, companyId: company.id, centreId: centre.id },
    select: { billNo: true, date: true, party: { select: { name: true } } },
  });
  if (!purchase) return { title: "FMS" };
  return {
    title: docTitle(
      company.name,
      "Purchase",
      purchase.billNo,
      purchase.party.name,
      titleDate(purchase.date)
    ),
  };
}


/**
 * A purchase as a document — the merchant's own record of what was bought from
 * a boat or seller, and what it came to.
 *
 * Same approach as the sale bill and the delivery note: server-rendered HTML
 * with a print stylesheet rather than a generated PDF, so it adds no
 * dependency, nothing to the app bundle, and the browser's print dialog already
 * offers Save as PDF.
 *
 * Unlike the sale bill this is an *internal* voucher, not a customer-facing
 * one. It therefore prints what the merchant needs to check a payment against —
 * the seller, the boat, the lines, and the running balance the purchase left on
 * that party's ledger — rather than terms addressed to a buyer.
 */
export default async function PurchasePrintPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireSession();
  const { id } = await params;

  const { company, centre } = await getActiveScope();
  if (!centre) notFound();

  const purchase = await prisma.purchase.findFirst({
    // Scoped exactly like the purchase's own page: a voucher belonging to
    // another company or centre must not print from the scope you are in.
    where: { id, companyId: company.id, centreId: centre.id },
    include: {
      company: {
        select: {
          id: true, name: true, legalName: true, address: true,
          phone: true, email: true, gstin: true, colour: true, logoKey: true,
        },
      },
      centre: { select: { name: true } },
      party: { select: { name: true, contactInfo: true } },
      lines: {
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
        include: { boat: { select: { name: true } } },
      },
    },
  });
  if (!purchase) notFound();

  // What the seller stands at across every bill, not just this one — payment is
  // settled against the party, so this is the figure they will recognise. Read
  // from the ledger's own running balance rather than re-summed here, so it can
  // never disagree with the party statement.
  const latest = await prisma.ledgerEntry.findFirst({
    where: {
      companyId: purchase.companyId,
      centreId: purchase.centreId,
      partyId: purchase.partyId,
    },
    orderBy: [{ date: "desc" }, { seq: "desc" }],
    select: { runningBalance: true },
  });
  const outstanding = latest?.runningBalance ?? new Prisma.Decimal(0);

  // Society and KFDC bills name a boat per row; Private and Local name one for
  // the whole voucher, or none. The same helper the entry form uses decides,
  // so the printed sheet always has the shape the voucher was entered in.
  const hasLineBoats = purchaseHasLineBoats(purchase.type);
  const hasLineBoxes = purchaseHasLineBoxes(purchase.type);
  const hasLines = purchase.lines.length > 0;

  const linesTotal = purchase.lines.reduce(
    (a, l) => a.add(l.total),
    new Prisma.Decimal(0)
  );
  const totalKg = purchase.lines.reduce(
    (a, l) => a.add(l.qtyKg),
    new Prisma.Decimal(0)
  );

  return (
    // data-company resolves --company for the band; the print layout has no
    // company of its own to set it from.
    <div
      className="bill-sheet"
      data-company={purchase.company.name}
      style={
        purchase.company.colour
          ? ({ "--company": purchase.company.colour } as React.CSSProperties)
          : undefined
      }
    >
      <PrintToolbar
        backHref={`/vouchers/purchases/${purchase.id}`}
        backLabel="Back to the purchase"
      />

      <div className="bill-paper">
        <PrintHeader
          company={purchase.company}
          centreName={purchase.centre.name}
          docKind={`${PURCHASE_TYPE_LABELS[purchase.type]} Purchase`}
          right={
            <>
              {purchase.billNo && (
                <div className="num text-[13px]">
                  <span className="opacity-75">Bill No. </span>
                  <span className="font-semibold">{purchase.billNo}</span>
                </div>
              )}
              <div className="num text-[13px]">
                <span className="opacity-75">Date </span>
                <span className="font-semibold">{fmtDate(purchase.date)}</span>
              </div>
            </>
          }
        />

        <div className="grid grid-cols-2 gap-6 mb-4">
          <div>
            <div className="text-[11px] uppercase tracking-wide text-muted font-semibold">
              Purchased from
            </div>
            <div className="text-[15px] font-semibold">
              {purchase.party.name}
            </div>
            {purchase.party.contactInfo && (
              <div className="text-[12px] text-muted">
                {purchase.party.contactInfo}
              </div>
            )}
          </div>
          <div className="text-[12px] bill-details">
            {/* The voucher-level boat is gone (spec §3.7) — a bill can cover
                several vessels, so the boat belongs to the line and is printed
                in the table. */}
            <Detail label="Centre" value={purchase.centre.name} />
          </div>
        </div>

        {hasLines ? (
          <table className="bill-table">
            <thead>
              <tr>
                <th className="w-8">#</th>
                {hasLineBoats && <th>Boat</th>}
                <th>Particulars</th>
                {/* Private and Local buy by the box; Society and KFDC state
                    their kilos outright. */}
                {hasLineBoxes && <th className="r">Box</th>}
                {hasLineBoxes && <th className="r">Kg / Box</th>}
                <th className="r">Total Kg</th>
                <th className="r">Rate/kg</th>
                <th className="r">Amount</th>
              </tr>
            </thead>
            <tbody>
              {purchase.lines.map((l, i) => (
                <tr key={l.id}>
                  <td className="num">{i + 1}</td>
                  {hasLineBoats && <td>{l.boat?.name ?? "—"}</td>}
                  <td>{l.particular}</td>
                  {hasLineBoxes && <td className="r num">{l.box || "—"}</td>}
                  {hasLineBoxes && (
                    <td className="r num">
                      {l.box > 0
                        ? new Prisma.Decimal(l.qtyKg)
                            .div(l.box)
                            .toDecimalPlaces(3)
                            .toString()
                        : "—"}
                    </td>
                  )}
                  <td className="r num">{fmtKg(l.qtyKg)}</td>
                  <td className="r num">{fmtMoney(l.pricePerKg)}</td>
                  <td className="r num">{fmtMoney(l.total)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={hasLineBoats ? 3 : 2}>Total</td>
                {hasLineBoxes && (
                  <>
                    <td className="r num">
                      {purchase.lines.reduce((a, l) => a + l.box, 0) || "—"}
                    </td>
                    <td />
                  </>
                )}
                <td className="r num">{fmtKg(totalKg)}</td>
                <td></td>
                <td className="r num">{fmtMoney(linesTotal)}</td>
              </tr>
            </tfoot>
          </table>
        ) : (
          // A lump-sum bill: the total was entered directly and the bill image
          // carries the detail, so there is nothing to tabulate.
          <table className="bill-table">
            <tbody>
              <tr>
                <td>Purchase total as entered</td>
                <td className="r num">{fmtMoney(purchase.amount)}</td>
              </tr>
            </tbody>
          </table>
        )}

        <div className="grid grid-cols-2 gap-6 mt-4">
          <div className="text-[12px]">
            <div className="text-muted">Amount in words</div>
            <div className="font-medium">
              {rupeesInWords(purchase.amount)}
            </div>
          </div>
          <div className="text-[12px] bill-details">
            <Detail label="Purchase amount" value={fmtMoney(purchase.amount)} />
            {/* Signed the same way as every ledger and statement: positive is
                owed to us, negative is owed by us. A purchase normally leaves
                the merchant owing, so this usually reads "we owe". */}
            <Detail
              label={
                outstanding.greaterThan(0)
                  ? "Party owes (all bills)"
                  : "We owe party (all bills)"
              }
              value={fmtMoney(outstanding.abs())}
            />
          </div>
        </div>

        {purchase.notes && (
          <div className="border-t border-line mt-3 pt-2">
            <div className="text-[11px] uppercase tracking-wide text-muted font-semibold">
              Notes
            </div>
            <div className="text-[12px] whitespace-pre-line">{purchase.notes}</div>
          </div>
        )}

        <div className="bill-sign">
          <div>Received by</div>
          <div>For {purchase.company.legalName ?? purchase.company.name}</div>
        </div>
      </div>
    </div>
  );
}

/** One label/value pair — two grid cells, not a flex row that spreads them. */
function Detail({ label, value }: { label: string; value: string }) {
  return (
    <>
      <span className="text-muted">{label}</span>
      <span className="font-medium">{value}</span>
    </>
  );
}
