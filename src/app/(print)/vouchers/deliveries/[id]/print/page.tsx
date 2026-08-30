import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getActiveScope } from "@/lib/centre";
import { requireSession } from "@/lib/session";
import { lineKgPerBox, lineTotalKg, sumDeliveryLines } from "@/lib/delivery";
import { fmtDate, fmtKg, fmtMoney } from "@/lib/format";
import { PACK_LABELS } from "@/lib/pack";
import { docTitle, titleDate } from "@/lib/doc-title";
import { PrintHeader } from "../../../../letterhead";
import { PrintToolbar } from "../../../../print-toolbar";
import "../../../../voucher-print.css";

/** The filename this note saves itself as — see src/lib/doc-title.ts. */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { company, centre } = await getActiveScope();
  if (!centre) return { title: "FMS" };
  const note = await prisma.deliveryNote.findFirst({
    where: { id, companyId: company.id, centreId: centre.id },
    select: {
      billNo: true,
      date: true,
      vehicle: { select: { number: true } },
    },
  });
  if (!note) return { title: "FMS" };
  return {
    title: docTitle(
      company.name,
      "Delivery-Note",
      note.billNo,
      note.vehicle.number,
      titleDate(note.date)
    ),
  };
}


/**
 * The delivery note as a document, to travel with the vehicle.
 *
 * Same approach as the sale bill: server-rendered HTML with a print stylesheet
 * rather than a generated PDF — no extra dependency, nothing added to the app
 * bundle, and the browser's print dialog already offers Save as PDF for a copy
 * to send on.
 *
 * A delivery note carries no accounting (it posts no ledger entry), so there is
 * no money on it beyond any advance handed to the driver. What it has to do is
 * let whoever receives the load check it against what arrived, which is why the
 * column totals are as prominent as the lines.
 */
export default async function DeliveryNotePrintPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireSession();
  const { id } = await params;

  const { company, centre } = await getActiveScope();
  if (!centre) notFound();

  const note = await prisma.deliveryNote.findFirst({
    // Scoped exactly like the note's own page: one belonging to another company
    // or centre must not print from the scope you are in.
    where: { id, companyId: company.id, centreId: centre.id },
    include: {
        vehicle: { select: { number: true, transporter: { select: { name: true } } } },
      company: {
        select: {
          id: true, name: true, legalName: true, address: true,
          phone: true, email: true, gstin: true, colour: true, logoKey: true,
        },
      },
      centre: { select: { name: true } },
      lines: { orderBy: { id: "asc" } },
    },
  });
  if (!note) notFound();

  const totals = sumDeliveryLines(note.lines);

  return (
    // data-company resolves --company for the band; the print layout has no
    // company of its own to set it from.
    <div
      className="bill-sheet"
      data-company={note.company.name}
      style={
        note.company.colour
          ? ({ "--company": note.company.colour } as React.CSSProperties)
          : undefined
      }
    >
      <PrintToolbar
        backHref={`/vouchers/deliveries/${note.id}`}
        backLabel="Back to the delivery note"
      />

      <div className="bill-paper">
        <PrintHeader
          company={note.company}
          centreName={note.centre.name}
          docKind="Delivery Note"
          right={
            <>
              <div className="num text-[13px]">
                <span className="opacity-75">No. </span>
                <span className="font-semibold">{note.billNo}</span>
              </div>
              <div className="num text-[13px]">
                <span className="opacity-75">Date </span>
                <span className="font-semibold">{fmtDate(note.date)}</span>
              </div>
            </>
          }
        />

        <div className="grid grid-cols-2 gap-6 mb-4">
          <div>
            <div className="text-[11px] uppercase tracking-wide text-muted font-semibold">
              Delivered to
            </div>
            <div className="text-[15px] font-semibold">{note.recipient}</div>
          </div>
          <div className="text-[12px] bill-details">
            <Detail label="Vehicle No." value={note.vehicle.number} />
            {note.driverName && (
              <Detail label="Driver" value={note.driverName} />
            )}
            {note.mobileNo && <Detail label="Mobile" value={note.mobileNo} />}
            {note.advancePaid && (
              <Detail
                label="Advance paid"
                value={fmtMoney(note.advancePaid)}
              />
            )}
          </div>
        </div>

        <table className="bill-table">
          <thead>
            <tr>
              <th className="r" style={{ width: "3rem" }}>
                Sl
              </th>
              <th>Pack</th>
              <th>Particulars</th>
              <th className="r">Kg / box</th>
              <th className="r">Box</th>
              <th className="r">Pcs</th>
              <th className="r">Total Kg</th>
            </tr>
          </thead>
          <tbody>
            {note.lines.map((l, i) => (
              <tr key={l.id}>
                <td className="r num text-muted">{i + 1}</td>
                {/* Box, Big Box or Loose. The party is taking delivery of the
                    crates as well as the fish, and a big box is twice the fish
                    of an ordinary one — so which kind travelled belongs on the
                    copy that goes with the truck, not only on our screen. */}
                <td className="text-muted">{PACK_LABELS[l.pack]}</td>
                <td className="font-medium">{l.particulars}</td>
                {/* What ONE box weighs, worked back out of the row's weight.
                    This printed `l.kg` — which stopped being the per-box figure
                    and became the row's whole weight. A note for 50 boxes of
                    1,000 kg printed "Kg / box 1,000 kg", fifty times the truth,
                    on the copy handed to the driver. */}
                <td className="r num">{lineKgPerBox(l).toString()}</td>
                <td className="r num">{l.box || "—"}</td>
                <td className="r num">{l.pcs || "—"}</td>
                {/* kg is the weight of ONE box, so the row's real weight is
                    kg × boxes — see lineTotalKg. Printing the per-box figure as
                    if it were the row total is how a load gets under-declared. */}
                <td className="r num">{fmtKg(lineTotalKg(l))}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={4} className="r">
                Total
              </td>
              <td className="r num">{totals.box || "—"}</td>
              <td className="r num">{totals.pcs || "—"}</td>
              <td className="r num">{fmtKg(totals.totalKg)}</td>
            </tr>
          </tfoot>
        </table>

        <p className="text-muted text-[11px] mt-3">
          A delivery note is a dispatch record only — it posts nothing to any
          ledger and is not a bill.
        </p>

        {note.notes && (
          <div className="border-t border-line mt-3 pt-2">
            <div className="text-[11px] uppercase tracking-wide text-muted font-semibold">
              Notes
            </div>
            <div className="text-[12px] whitespace-pre-line">{note.notes}</div>
          </div>
        )}

        <div className="bill-sign">
          <div>Dispatched by</div>
          <div>Driver</div>
          <div>Received by</div>
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
