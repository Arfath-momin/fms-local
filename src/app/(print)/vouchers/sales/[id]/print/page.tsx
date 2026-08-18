import { notFound } from "next/navigation";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { getActiveScope } from "@/lib/centre";
import { requireSession } from "@/lib/session";
import { SALE_TYPE_LABELS, saleLineTotalKg } from "@/lib/sale";
import { fmtDate, fmtKg, fmtMoney } from "@/lib/format";
import { rupeesInWords } from "@/lib/amount-words";
import { PrintHeader } from "../../../../letterhead";
import { PrintToolbar } from "../../../../print-toolbar";
import "../../../../voucher-print.css";

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

  const isFishMill = sale.type === "FISH_MILL";
  const hasLines = sale.lines.length > 0;

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
          <div className="text-[12px] grid gap-0.5">
            {sale.place && <Detail label="Place" value={sale.place} />}
            {sale.vehicleNo && (
              <Detail label="Vehicle No." value={sale.vehicleNo} />
            )}
            {sale.placeOfLoading && (
              <Detail label="Place of loading" value={sale.placeOfLoading} />
            )}
            {sale.weight && (
              <Detail label="Weight" value={fmtKg(sale.weight)} />
            )}
            {sale.netWeight && (
              <Detail label="Net weight" value={fmtKg(sale.netWeight)} />
            )}
            {sale.returnNote && (
              <Detail label="Return" value={sale.returnNote} />
            )}
          </div>
        </div>

        {/* Items */}
        {hasLines ? (
          <table className="bill-table">
            <thead>
              <tr>
                <th className="r" style={{ width: "3rem" }}>
                  Sl
                </th>
                {isFishMill && <th className="r">Box</th>}
                <th>{isFishMill ? "Variety" : "Particular"}</th>
                <th className="r">{isFishMill ? "Kgs / box" : "Kgs"}</th>
                {isFishMill && <th className="r">Total Kg</th>}
                <th className="r">Rate/kg</th>
                {isFishMill && <th className="r">Count</th>}
                <th className="r">Amount</th>
              </tr>
            </thead>
            <tbody>
              {sale.lines.map((l, i) => (
                <tr key={l.id}>
                  <td className="r num text-muted">{i + 1}</td>
                  {isFishMill && <td className="r num">{l.box ?? "—"}</td>}
                  <td className="font-medium">{l.particular}</td>
                  <td className="r num">{fmtKg(l.qtyKg)}</td>
                  {/* Kgs is the weight of ONE box, so what was actually sold —
                      and what the rate is charged on — is box × kgs. */}
                  {isFishMill && (
                    <td className="r num">
                      {fmtKg(
                        saleLineTotalKg({
                          qtyKg: Number(l.qtyKg),
                          box: l.box,
                        })
                      )}
                    </td>
                  )}
                  <td className="r num">{fmtMoney(l.ratePerKg)}</td>
                  {isFishMill && <td className="r num">{l.count ?? "—"}</td>}
                  <td className="r num">{fmtMoney(l.total)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={isFishMill ? 7 : 4} className="r">
                  Total
                </td>
                <td className="r num">{fmtMoney(sale.amount)}</td>
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

        {/* Market sales are billed gross, less the 2% commission — the buyer
            expects to see all three figures, not just the net. */}
        {sale.totalBill && (
          <table className="bill-table mt-3" style={{ maxWidth: "20rem", marginLeft: "auto" }}>
            <tbody>
              <tr>
                <td>Total bill</td>
                <td className="r num">{fmtMoney(sale.totalBill)}</td>
              </tr>
              {sale.commission && (
                <tr>
                  <td>Less commission (2%)</td>
                  <td className="r num">{fmtMoney(sale.commission)}</td>
                </tr>
              )}
              <tr>
                <td className="font-semibold">Net bill</td>
                <td className="r num font-semibold">{fmtMoney(sale.amount)}</td>
              </tr>
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

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
