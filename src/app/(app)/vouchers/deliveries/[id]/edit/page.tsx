import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getActiveScope, scopeFieldValues } from "@/lib/centre";
import { canEdit, requireSession } from "@/lib/session";
import { toInputDate } from "@/lib/format";
import { updateDelivery } from "../../actions";
import { DeliveryForm } from "../../delivery-form";
import { ReviewPanel } from "../../../review-panel";

export default async function EditDeliveryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireSession();
  const { id } = await params;
  if (!canEdit(session.role)) redirect(`/vouchers/deliveries/${id}`);

  const { company, centre } = await getActiveScope();
  if (!centre) notFound();

  const note = await prisma.deliveryNote.findFirst({
    // Scoped, not just found by id. A voucher belonging to another company or
    // centre must not open — let alone be editable — from the scope you are in.
    where: { id, companyId: company.id, centreId: centre.id },
    include: { lines: { orderBy: { id: "asc" } }, vehicle: { select: { number: true, transporter: { select: { name: true } } } } },
  });
  if (!note) notFound();

  // Drives the "choosing a new one replaces it" hint on the upload field.
  const existingAttachments = await prisma.attachment.count({
    where: { linkedType: "DELIVERY_NOTE", linkedId: note.id },
  });

  return (
    <div>
      <h1 className="heading text-xl font-semibold mb-4">Edit Delivery Note</h1>
      {/* Whatever the accountant asked for, kept in view while it is fixed.
          Collapses to nothing when no review was requested. */}
      <div className="mb-4 empty:hidden [&>*]:mt-0">
        <ReviewPanel
          linkedType="DELIVERY_NOTE"
          linkedId={note.id}
          noun="delivery note"
        />
      </div>
      <DeliveryForm
        action={updateDelivery.bind(null, note.id)}
        initial={{
          billNo: note.billNo,
          date: toInputDate(note.date),
          // Optional now — who received what comes from the bills that point
          // back at this trip, not from a typed name (spec §3.2).
          recipient: note.recipient ?? "",
          channel: note.channel,
          vehicleNo: note.vehicle.number,
          transporterName: note.vehicle.transporter.name,
          rentAmount: note.rentAmount?.toString() ?? "",
          advancePaid: note.advancePaid?.toString() ?? "",
          driverName: note.driverName ?? "",
          mobileNo: note.mobileNo ?? "",
          notes: note.notes ?? "",
          lines: note.lines.map((l) => ({
            particulars: l.particulars,
            kg: l.kg.toString(),
            box: l.box ? String(l.box) : "",
            bigBox: l.bigBox ? String(l.bigBox) : "",
            loose: l.loose ? String(l.loose) : "",
            pcs: l.pcs ? String(l.pcs) : "",
          })),
        }}
        submitLabel="Save Changes"
        existingAttachments={existingAttachments}
        scope={scopeFieldValues({ company, centre })}
      />
    </div>
  );
}
