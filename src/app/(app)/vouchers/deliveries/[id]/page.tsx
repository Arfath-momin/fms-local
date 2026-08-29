import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getActiveScope } from "@/lib/centre";
import { canEdit, canEnter, requireSession } from "@/lib/session";
import { lineKgPerBox, lineTotalKg, sumDeliveryLines } from "@/lib/delivery";
import { PACK_LABELS } from "@/lib/pack";
import {
  tallyTrip,
  TRIP_CHANNEL_LABELS,
  TRIP_STATUS_LABELS,
} from "@/lib/trip";
import { fmtDate, fmtKg, fmtMoney } from "@/lib/format";
import { getAttachments } from "@/lib/attachments";
import { uploadAttachment } from "../../../attachments/actions";
import { AttachmentPanel } from "../../../attachments/attachment-panel";
import { DeleteVoucher } from "../../delete-voucher";
import { ReviewPanel } from "../../review-panel";
import { VoucherMeta } from "../../voucher-meta";
import { deleteDelivery } from "../actions";

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-muted font-semibold">
        {label}
      </div>
      <div className="text-[14px] font-medium">{value || "—"}</div>
    </div>
  );
}

export default async function DeliveryNotePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireSession();
  const mayEdit = canEdit(session.role);
  const mayEnter = canEnter(session.role);
  const { id } = await params;

  const { company, centre } = await getActiveScope();
  if (!centre) notFound();

  const note = await prisma.deliveryNote.findFirst({
    // Scoped, not just found by id. A voucher belonging to another company or
    // centre must not open — let alone be editable — from the scope you are in.
    where: { id, companyId: company.id, centreId: centre.id },
    include: {
        vehicle: { select: { number: true, transporter: { select: { name: true } } } },
      company: { select: { name: true } },
      centre: { select: { name: true } },
      lines: { orderBy: { id: "asc" } },
      // The bills that came back off this trip — what the reconciliation
      // tallies against what went out.
      sales: {
        orderBy: [{ date: "asc" }, { billNo: "asc" }],
        select: {
          id: true,
          billNo: true,
          type: true,
          amount: true,
          rentDeducted: true,
          party: { select: { name: true } },
          lines: { select: { qtyKg: true, box: true, pack: true } },
        },
      },
      createdBy: { select: { name: true } },
      updatedBy: { select: { name: true } },
    },
  });
  if (!note) notFound();

  const totals = sumDeliveryLines(note.lines);
  const tally = tallyTrip(note);
  const attachments = await getAttachments("DELIVERY_NOTE", note.id);

  return (
    <div className="max-w-3xl">
      <div className="flex items-end justify-between flex-wrap gap-3 mt-1 mb-4">
        <div>
          <h1 className="heading text-xl font-semibold">
            Delivery Note · {note.billNo}
          </h1>
          <p className="text-muted text-[13px]">
            {note.company.name} · {note.centre.name} · record only
          </p>
        </div>
        <div className="flex gap-2">
          {/* The copy that travels with the vehicle. The browser's print dialog
              is also where "Save as PDF" lives, so this covers both. */}
          <Link
            href={`/vouchers/deliveries/${note.id}/print`}
            className="border border-line-strong bg-surface px-4 py-2 text-[13px] font-semibold hover:border-accent"
          >
            Save as PDF
          </Link>
          {mayEdit && (
            <Link
              href={`/vouchers/deliveries/${note.id}/edit`}
              className="border border-line-strong bg-surface px-4 py-2 text-[13px] font-semibold hover:border-accent"
            >
              Edit
            </Link>
          )}
        </div>
      </div>

      <div className="border border-line-strong bg-surface px-4 py-3 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 mb-4">
        <Field label="Bill No." value={note.billNo} />
        <Field label="Date" value={fmtDate(note.date)} />
        <Field label="To" value={note.recipient ?? "—"} />
        {/* Only on notes raised while the channel still meant something. It
            decides nothing now — every open trip is offered to every bill. */}
        {note.channel && (
          <Field label="Dispatched as" value={TRIP_CHANNEL_LABELS[note.channel]} />
        )}
        <Field label="Status" value={TRIP_STATUS_LABELS[note.status]} />
        <Field label="Vehicle No." value={note.vehicle.number} />
        <Field
          label="Advance Paid"
          value={note.advancePaid ? fmtMoney(note.advancePaid) : "—"}
        />
        <Field label="Transporter" value={note.vehicle.transporter.name} />
        <Field label="Driver Name" value={note.driverName ?? "—"} />
        <Field label="Mobile No." value={note.mobileNo ?? "—"} />
      </div>

      {/* No rent panel. Vehicle rent is an ordinary expense voucher now —
          agreed when the truck is loaded, entered then, whatever the trip turns
          out to sell. See the RENT spec in src/lib/expense.ts. */}

      {/* Trip reconciliation — one panel serving both tallies, because the
          question differs by channel:
            MARKET   a truck visits several markets, so bills arrive piecemeal
                     and the BOXES have to add up.
            FACTORY  the whole load goes to one buyer who reweighs on arrival
                     and pays for less, so the KILO gap is the rejection.
          Both are shown against what actually went out on this trip. */}
      <div className="border border-line-strong bg-surface px-4 py-3 mb-4">
        <div className="flex items-baseline justify-between flex-wrap gap-3 mb-2">
          <h2 className="heading text-[15px] font-semibold">
            Reconciliation{" "}
            <Link
              href="/ledgers/crates"
              className="text-accent text-[12px] font-normal underline underline-offset-2"
            >
              box statement
            </Link>
          </h2>
          <span className="text-muted text-[12px]">
            {tally.billCount === 0
              ? "No bills back yet"
              : `${tally.billCount} bill${tally.billCount === 1 ? "" : "s"} · ${fmtMoney(tally.billedAmount)}`}
          </span>
        </div>

        {/* BOXES, on every trip.
            
            This used to switch on the note's channel — boxes for a market
            trip, kilos for anything else. Channel was retired because one
            truck serves several channels, so it now reads null on every new
            trip and every one of them got the kilo view. A trip whose bills
            were one market and one mill then showed "Kg accepted 1,900"
            against 500 kg out, because a market bill carries no kilos at all
            and the mill's were being multiplied by their own box count.
            
            Boxes are the one unit every channel itemises, so they are the
            reconciliation. */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 text-[13px]">
          <Field label="Boxes out" value={String(tally.boxesDispatched)} />
          <Field label="Boxes billed" value={String(tally.boxesBilled)} />
          <Field
            label="Unbilled"
            value={String(
              Math.max(0, tally.boxesDispatched - tally.boxesBilled)
            )}
          />
          <Field
            label="Crates back"
            value={
              note.cratesReturned == null ? "—" : String(note.cratesReturned)
            }
          />
        </div>

        {/* The kilo gap, only where it is a real one.
        
            A factory or mill reweighs on arrival and pays for what it accepts,
            so the shortfall against what went out IS the rejection. That only
            holds when every bill off the trip works that way — one market bill
            among them and the gap is just the boxes the market took, measured
            in a unit it never used. */}
        {tally.weighedOnly && (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 text-[13px] mt-3 pt-3 border-t border-line">
            <Field label="Kg out" value={fmtKg(tally.kgDispatched)} />
            <Field label="Kg accepted" value={fmtKg(tally.kgBilled)} />
            <Field label="Rejected" value={fmtKg(tally.kgGap)} />
            {/* Valued at what the accepted fish actually fetched — a
                rejection is worth what the rest of the load sold for. */}
            <Field label="Gap value" value={fmtMoney(tally.gapValue)} />
          </div>
        )}


        {note.sales.length > 0 && (
          <table className="ledger-table mt-3">
            <thead>
              <tr>
                <th>Bill</th>
                <th>Party</th>
                <th className="num-col">Boxes</th>
                <th className="num-col">Kg</th>
                <th className="num-col">Amount</th>
              </tr>
            </thead>
            <tbody>
              {note.sales.map((sale) => (
                <tr key={sale.id}>
                  <td>
                    <Link
                      href={`/vouchers/sales/${sale.id}`}
                      className="text-accent underline underline-offset-2"
                    >
                      {sale.billNo}
                    </Link>
                    {sale.rentDeducted && Number(sale.rentDeducted) > 0 && (
                      <span className="text-muted text-[12px]">
                        {" "}
                        · market deducted {fmtMoney(sale.rentDeducted)}
                      </span>
                    )}
                  </td>
                  <td>{sale.party.name}</td>
                  {/* Both columns, and each bill fills in the one it keeps.
                      A market bill is itemised in boxes and has no weight; a
                      mill bill has both. Showing one column headed by the
                      trip's channel meant a market bill read "0 kg", which
                      looked like nothing was delivered. */}
                  <td className="num-col num">
                    {sale.lines.reduce(
                      (a, l) => a + (l.pack === "LOOSE" ? 0 : (l.box ?? 0)),
                      0
                    ) || "—"}
                  </td>
                  <td className="num-col num">
                    {(() => {
                      const kg = sale.lines.reduce(
                        (a, l) => a + Number(l.qtyKg),
                        0
                      );
                      return kg > 0 ? fmtKg(kg) : "—";
                    })()}
                  </td>
                  <td className="num-col num">{fmtMoney(sale.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="border border-line-strong bg-surface overflow-x-auto">
        <table className="ledger-table">
          <thead>
            <tr>
              <th>Pack</th>
              <th>Particulars</th>
              <th className="num-col">Box</th>
              <th className="num-col">Kg / box</th>
              <th className="num-col">Total Kg</th>
              <th className="num-col">Pcs</th>
            </tr>
          </thead>
          <tbody>
            {note.lines.map((l) => (
              <tr key={l.id}>
                <td>{PACK_LABELS[l.pack]}</td>
                <td className="font-medium">{l.particulars}</td>
                <td className="num-col num">{l.box || "—"}</td>
                {/* The per-box figure that was typed, worked back out of the
                    weight stored against the boxes it was spread over. */}
                <td className="num-col num text-muted">
                  {lineKgPerBox(l).toString()}
                </td>
                <td className="num-col num font-semibold">
                  {lineTotalKg(l).toString()}
                </td>
                <td className="num-col num">{l.pcs}</td>
              </tr>
            ))}
            <tr className="border-t border-line-strong font-semibold">
              <td />
              <td className="text-right">Total</td>
              <td className="num-col num">{totals.box}</td>
              <td className="num-col num" />
              <td className="num-col num">{totals.totalKg.toString()}</td>
              <td className="num-col num">{totals.pcs}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="text-muted text-[12px] mt-2">
        Kg / box is what one box weighs; Total Kg is that multiplied by the
        boxes. A LOOSE row is fish too big to box — it goes straight onto the
        truck, carries no crates, and stays out of every box tally.
      </p>

      <AttachmentPanel
        attachments={attachments.map((a) => ({
          id: a.id,
          uploadedAt: a.uploadedAt.toISOString(),
        }))}
        action={uploadAttachment.bind(
          null,
          "DELIVERY_NOTE",
          note.id,
          `/vouchers/deliveries/${note.id}`
        )}
        canUpload={mayEnter}
      />

      <VoucherMeta
        createdBy={note.createdBy}
        createdAt={note.createdAt}
        updatedBy={note.updatedBy}
        updatedAt={note.updatedAt}
      />

      <ReviewPanel
        linkedType="DELIVERY_NOTE"
        linkedId={note.id}
        noun="delivery note"
      />

      {mayEdit && (
        <DeleteVoucher
          action={deleteDelivery.bind(null, note.id)}
          noun="delivery note"
          warning="The note and its line items are removed. No ledger is affected — a delivery note carries no accounting."
        />
      )}
    </div>
  );
}
