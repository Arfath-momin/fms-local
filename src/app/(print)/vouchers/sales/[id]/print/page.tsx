import { notFound } from "next/navigation";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { getActiveScope } from "@/lib/centre";
import { requireSession } from "@/lib/session";
import { SALE_TYPE_LABELS, saleLineTotalKg } from "@/lib/sale";
import { fmtDate, fmtKg, fmtMoney } from "@/lib/format";
import { rupeesInWords } from "@/lib/amount-words";
import { docTitle, titleDate } from "@/lib/doc-title";
import { PrintHeader } from "../../../../letterhead";
import { PrintToolbar } from "../../../../print-toolbar";
import "../../../../voucher-print.css";

/**
 * The filename this bill saves itself as. See src/lib/doc-title.ts — a browser
 * names a "Save as PDF" file after the document title, and every one of these
 * used to inherit "FMS" from the root layout.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { company, centre } = await getActiveScope();
  if (!centre) return { title: "FMS" };
  // A deliberately tiny read: this runs alongside the page's own query, and
  // there is no reason to fetch a whole bill to name a file.
  const sale = await prisma.sale.findFirst({
    where: { id, companyId: company.id, centreId: centre.id },
    select: { billNo: true, date: true, type: true },
  });
  if (!sale) return { title: "FMS" };
  return {
    title: docTitle(
      company.name,
      SALE_TYPE_LABELS[sale.type],
      "Bill",
      sale.billNo,
      titleDate(sale.date)
    ),
  };
}


/**
 * The customer-facing bill for one sale, as a document.
 *
 * Server-rendered HTML with a print stylesheet rather than a generated PDF: it
 * adds no dependency, no JavaScript to the app bundle and no render cost, and
 * the browser's own print dialog already offers "Save as PDF" for a file to
 * send on. If a server-generated PDF is ever wanted, its input is a URL — this
 * one — so nothing here is wasted.
 */
export default async function SaleBillPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireSession();
  const { id } = await params;

  const { company, centre } = await getActiveScope();
  if (!centre) notFound();

  const sale = await prisma.sale.findFirst({
    // Scoped exactly like the sale's own page: a bill belonging to another
    // company or centre must not print from the scope you are in.
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
      careOfParty: { select: { name: true } },
      lines: { orderBy: { id: "asc" } },
      // The truck this bill's fish travelled on. The sale stopped carrying its
      // own vehicle number — it was a second place to type one the trip already
      // knew — so the bill reads it from the trip, or failing that from the
      // rent recorded against the bill, which names the same truck.
      deliveryNote: { select: { vehicle: { select: { number: true } } } },
      expenses: {
        where: { category: { code: "RENT" } },
        select: { details: true },
        take: 1,
      },
    },
  });
  if (!sale) notFound();

  // What the party owes across every bill, not just this one — collection is
  // tracked against the party, so this is the figure they will recognise.
  const ledgerPartyId = sale.careOfPartyId ?? sale.partyId;
  const latest = await prisma.ledgerEntry.findFirst({
    where: {
      companyId: sale.companyId,
      centreId: sale.centreId,
      partyId: ledgerPartyId,
    },
    orderBy: [{ date: "desc" }, { seq: "desc" }],
    select: { runningBalance: true },
  });
  const outstanding = latest?.runningBalance ?? new Prisma.Decimal(0);

  // Trip first, then the rent row, then whatever an older bill typed for
  // itself — the column is still there for bills entered while it existed.
  const rentDetails = (sale.expenses[0]?.details ?? {}) as Record<string, string>;
  const vehicleNo =
    sale.deliveryNote?.vehicle.number ?? rentDetails.vehicleNo ?? sale.vehicleNo;

  const isFishMill = sale.type === "FISH_MILL";
  // Factory rows carry a count now too, so the header follows the DATA rather
  // than the sale type: a bill that recorded counts prints them, one that did
  // not gets a plain Kgs column instead of an empty prefix.
  const anyCount = sale.lines.some((l) => l.count != null);
  // A market line is a BOX record: which market took how many of the load.
  const isMarket = sale.type === "MARKET";
  const totalBoxes = sale.lines.reduce(
    // A LOOSE row never went into a crate, so it contributes none.
    (a, l) => a + (l.pack === "LOOSE" ? 0 : (l.box ?? 0)),
    0
  );
  /** Does this bill count boxes at all? Local yard sales often do not. */
  const anyBox = sale.lines.some((l) => l.pack !== "LOOSE" && (l.box ?? 0) > 0);
  const hasLines = sale.lines.length > 0;

  // Summed from the same helper each row prints, so the column and its total
  // can never be two different calculations.
  const totalKg = sale.lines.reduce(
    (a, l) => a + saleLineTotalKg({ qtyKg: Number(l.qtyKg), box: l.box }),
    0
  );

  return (
    // data-company resolves --company for the band; the print layout has no
    // company of its own to set it from.
    <div
      className="bill-sheet"
      data-company={sale.company.name}
      style={
        sale.company.colour
          ? ({ "--company": sale.company.colour } as React.CSSProperties)
          : undefined
      }
    >
      <PrintToolbar
        backHref={`/vouchers/sales/${sale.id}`}
        backLabel="Back to the sale"
      />

      <div className="bill-paper">
        <PrintHeader
          company={sale.company}
          centreName={sale.centre.name}
          docKind={`${SALE_TYPE_LABELS[sale.type]} Sale Bill`}
          right={
            <>
              <div className="num text-[13px]">
                <span className="opacity-75">No. </span>
                <span className="font-semibold">{sale.billNo}</span>
              </div>
              <div className="num text-[13px]">
                <span className="opacity-75">Date </span>
                <span className="font-semibold">
                  {fmtDate(sale.saleDate ?? sale.date)}
                </span>
              </div>
              {/* The buying day, stated whenever it differs from the sale's
                  own date. Fish bought on the 30th and sold on the 31st is one
                  transaction with two dates, and a bill showing only the later
                  one leaves the reader to guess which catch it came off. */}
              {sale.saleDate &&
                sale.saleDate.getTime() !== sale.date.getTime() && (
                  <div className="num text-[12px]">
                    <span className="opacity-75">Purchase date </span>
                    <span className="font-semibold">{fmtDate(sale.date)}</span>
                  </div>
                )}
            </>
          }
        />

        {/* Buyer */}
        <div className="grid grid-cols-2 gap-6 mb-4">
          <div>
            <div className="text-[11px] uppercase tracking-wide text-muted font-semibold">
              Billed to
            </div>
            <div className="text-[15px] font-semibold">{sale.party.name}</div>
            {sale.party.contactInfo && (
              <div className="text-muted text-[12px]">
                {sale.party.contactInfo}
              </div>
            )}
            {sale.careOfParty && (
              <div className="text-muted text-[12px]">
                c/o {sale.careOfParty.name}
              </div>
            )}
          </div>
          <div className="text-[12px] bill-details">
            {/* Which of the two businesses is selling. Obvious on screen from
                the company band; on a Fish Mill bill leaving the building it
                has to be stated, because BFM and B2B bill the same mills. */}
            {isFishMill && (
              <Detail label="Supplier" value={sale.company.name} />
            )}
            {sale.place && <Detail label="Place" value={sale.place} />}
            {vehicleNo && <Detail label="Vehicle No." value={vehicleNo} />}
            {sale.placeOfLoading && (
              <Detail label="Place of loading" value={sale.placeOfLoading} />
            )}
            {sale.weight && (
              <Detail label="Total weight" value={fmtKg(sale.weight)} />
            )}
            {/* The same column under the name each trade gives it: a mill
                deducts for water and ice, a factory hands kilos back. */}
            {sale.waterLess && Number(sale.waterLess) > 0 && (
              <Detail
                label={sale.type === "FACTORY" ? "Return" : "Water less"}
                value={fmtKg(sale.waterLess)}
              />
            )}
            {sale.netWeight && (
              <Detail label="Net weight" value={fmtKg(sale.netWeight)} />
            )}
            {sale.totalBox != null && sale.totalBox > 0 && (
              <Detail label="Total box" value={String(sale.totalBox)} />
            )}
            {/* A remark typed on an older bill, before the return became a
                weight in its own right. Kept so those bills still print it. */}
            {sale.returnNote && (
              <Detail label="Note" value={sale.returnNote} />
            )}
          </div>
        </div>

        {/* Items */}
        {hasLines ? (
          <table className="bill-table">
            <thead>
              {/* Each bill prints what its channel actually means.
                    MARKET    boxes. The money is the net the market paid, not
                              a rate times a weight, so a Kgs and Rate column
                              would print zeros and invite the reader to
                              multiply them.
                    FISH MILL what it was, how much, at what rate, for how
                              much. Box and kgs-per-box are how the load was
                              weighed — working the clerk needs, not the mill. */}
              <tr>
                <th className="r" style={{ width: "3rem" }}>
                  Sr No
                </th>
                <th>Particulars</th>
                {/* Boxes on EVERY channel that has them, not just market.
                    A mill or factory bill is unloaded box by box and the buyer
                    counts them off the truck; leaving the column out meant the
                    one figure both sides check on the ground was the one figure
                    missing from the paper. Blank where a bill has none. */}
                {anyBox && <th className="r">Box</th>}
                {isMarket ? (
                  <th className="r">Boxes</th>
                ) : (
                  <>
                    {anyCount ? (
                      <th className="r">Count / Kg</th>
                    ) : (
                      <th className="r">Kgs</th>
                    )}
                    <th className="r">Rate/kg</th>
                    <th className="r">Amount</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {sale.lines.map((l, i) => (
                <tr key={l.id}>
                  <td className="r num text-muted">{i + 1}</td>
                  <td className="font-medium">{l.particular}</td>
                  {anyBox && !isMarket && (
                    <td className="r num">{l.box ?? "—"}</td>
                  )}
                  {isMarket ? (
                    <td className="r num">{l.box ?? "—"}</td>
                  ) : (
                    <>
                      <td className="r num">
                        {/* The row's own weight. It used to be the weight of a
                            single box, multiplied up by the boxes; saleLineTotalKg
                            carries that history so this reads the same however
                            old the bill is. The count prefixes it where the mill
                            recorded one, since "180 / 45.500 kg" is how the
                            trade reads a line. */}
                        {l.count ? `${l.count} / ` : ""}
                        {fmtKg(
                          saleLineTotalKg({
                            qtyKg: Number(l.qtyKg),
                            box: l.box,
                          })
                        )}
                      </td>
                      <td className="r num">{fmtMoney(l.ratePerKg)}</td>
                      <td className="r num">{fmtMoney(l.total)}</td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2} className="r">
                  Total
                </td>
                {anyBox && !isMarket && (
                  <td className="r num">{totalBoxes || "—"}</td>
                )}
                {isMarket ? (
                  <td className="r num">{totalBoxes || "—"}</td>
                ) : (
                  <>
                    {/* Kg total sits under the column it totals, so the mill
                        can check the weight it received against the money
                        charged without reading across the sheet. */}
                    <td className="r num">{fmtKg(totalKg)}</td>
                    <td></td>
                    <td className="r num">{fmtMoney(sale.amount)}</td>
                  </>
                )}
              </tr>
            </tfoot>
          </table>
        ) : (
          <table className="bill-table">
            <tbody>
              <tr>
                <td className="font-medium">
                  {SALE_TYPE_LABELS[sale.type]} sale as per bill
                </td>
                <td className="r num">{fmtMoney(sale.amount)}</td>
              </tr>
            </tbody>
          </table>
        )}

        {/* The market bill's working, exactly as the entry screen shows it
            and as the market's own paper reads.

            It used to print Total, then Net, then commission and reserve
            listed BELOW the net with a note saying they were not deductions
            from it. That was wrong twice over: they ARE netted inside the net
            bill (spec invariants 3 and 4), and printing them after it invited
            the reader to subtract them a second time. Cutting and the labour
            balancing figure were missing altogether, so the four deductions
            never added up to the difference the sheet was showing.

            Rent is not among them. What the market handed the driver settles
            part of this bill rather than shrinking it, so it comes off below
            the net as a receipt — which is where the market looks to see what
            it still owes. */}
        {sale.totalBill && (
          <table
            className="bill-table mt-3"
            style={{ maxWidth: "24rem", marginLeft: "auto" }}
          >
            <tbody>
              <tr>
                <td>Total bill</td>
                <td className="r num">{fmtMoney(sale.totalBill)}</td>
              </tr>
              {sale.commission && Number(sale.commission) > 0 && (
                <tr>
                  <td>
                    Less commission
                    {sale.commissionRate && (
                      <span className="text-muted">
                        {" "}
                        ({sale.commissionRate.toString()}%)
                      </span>
                    )}
                  </td>
                  <td className="r num">−{fmtMoney(sale.commission)}</td>
                </tr>
              )}
              {sale.cutting && Number(sale.cutting) > 0 && (
                <tr>
                  <td>
                    Less cutting
                    {sale.cuttingRate && (
                      <span className="text-muted">
                        {" "}
                        ({sale.cuttingRate.toString()}%)
                      </span>
                    )}
                  </td>
                  <td className="r num">−{fmtMoney(sale.cutting)}</td>
                </tr>
              )}
              {sale.reserve && Number(sale.reserve) > 0 && (
                <tr>
                  <td>
                    Less reserve<span className="text-muted"> (held)</span>
                  </td>
                  <td className="r num">−{fmtMoney(sale.reserve)}</td>
                </tr>
              )}
              {sale.otherDeduction && Number(sale.otherDeduction) > 0 && (
                <tr>
                  <td>Less labour / other</td>
                  <td className="r num">−{fmtMoney(sale.otherDeduction)}</td>
                </tr>
              )}
              <tr>
                <td className="font-semibold">Net bill</td>
                <td className="r num font-semibold">{fmtMoney(sale.amount)}</td>
              </tr>
              {sale.rentDeducted && Number(sale.rentDeducted) > 0 && (
                <>
                  <tr>
                    <td>Less receipt — paid the driver</td>
                    <td className="r num">−{fmtMoney(sale.rentDeducted)}</td>
                  </tr>
                  <tr>
                    <td className="font-semibold">Still owed on this bill</td>
                    <td className="r num font-semibold">
                      {fmtMoney(
                        Number(sale.amount) - Number(sale.rentDeducted)
                      )}
                    </td>
                  </tr>
                </>
              )}
            </tbody>
          </table>
        )}

        {/* Amount in words */}
        <div className="border-t border-line-strong mt-4 pt-3">
          <div className="text-[11px] uppercase tracking-wide text-muted font-semibold">
            Amount in words
          </div>
          <div className="text-[13px] font-medium">
            {rupeesInWords(sale.amount)}
          </div>
        </div>

        {outstanding.greaterThan(0) && (
          <p className="text-[12px] mt-3">
            <span className="text-muted">
              Total outstanding for {(sale.careOfParty ?? sale.party).name}{" "}
              across all bills:{" "}
            </span>
            <span className="num font-semibold">{fmtMoney(outstanding)}</span>
          </p>
        )}

        {sale.notes && (
          <div className="border-t border-line mt-3 pt-2">
            <div className="text-[11px] uppercase tracking-wide text-muted font-semibold">
              Notes
            </div>
            <div className="text-[12px] whitespace-pre-line">{sale.notes}</div>
          </div>
        )}

        {/* Signatures */}
        <div className="flex justify-between gap-8 mt-12 text-[12px] text-muted">
          <div className="border-t border-line-strong pt-1 w-40 text-center">
            Receiver&rsquo;s signature
          </div>
          <div className="border-t border-line-strong pt-1 w-40 text-center">
            For {sale.company.name}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * One label/value pair in a voucher header.
 *
 * Two grid cells, NOT a flex row that pushes them apart. As a flex
 * space-between the label sat on one edge and the value on the other, an inch
 * of nothing between "Vehicle No." and the number — see .bill-details.
 */
function Detail({ label, value }: { label: string; value: string }) {
  return (
    <>
      <span className="text-muted">{label}</span>
      <span className="font-medium">{value}</span>
    </>
  );
}
