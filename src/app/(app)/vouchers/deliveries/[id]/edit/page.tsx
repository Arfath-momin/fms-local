import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { canEdit, requireSession } from "@/lib/session";
import { toInputDate } from "@/lib/format";
import { updateDelivery } from "../../actions";
import { DeliveryForm } from "../../delivery-form";

export default async function EditDeliveryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireSession();
  const { id } = await params;
  if (!canEdit(session.role)) redirect(`/vouchers/deliveries/${id}`);

  const note = await prisma.deliveryNote.findUnique({
    where: { id },
    include: { lines: { orderBy: { id: "asc" } } },
  });
  if (!note) notFound();

  // Drives the "choosing a new one replaces it" hint on the upload field.
  const existingAttachments = await prisma.attachment.count({
    where: { linkedType: "DELIVERY_NOTE", linkedId: note.id },
  });

  return (
    <div>
      <h1 className="heading text-xl font-semibold mb-4">Edit Delivery Note</h1>
      <DeliveryForm
        action={updateDelivery.bind(null, note.id)}
        initial={{
          billNo: note.billNo,
          date: toInputDate(note.date),
          recipient: note.recipient,
          vehicleNo: note.vehicleNo,
          advancePaid: note.advancePaid?.toString() ?? "",
          driverName: note.driverName ?? "",
          mobileNo: note.mobileNo ?? "",
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
      />
    </div>
  );
}
