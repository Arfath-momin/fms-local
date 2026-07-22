import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { toInputDate } from "@/lib/format";
import { CHANNEL_LABELS } from "@/lib/delivery";
import { updateDelivery } from "../../actions";
import { DeliveryForm } from "../../delivery-form";

export default async function EditDeliveryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireSession();
  const { id } = await params;
  if (session.role !== "MERCHANT") redirect(`/vouchers/deliveries/${id}`);

  const note = await prisma.deliveryNote.findUnique({
    where: { id },
    include: {
      party: { select: { name: true } },
      _count: { select: { settlements: true } },
    },
  });
  if (!note) notFound();
  if (note.status !== "PENDING" || note._count.settlements > 0)
    redirect(`/vouchers/deliveries/${id}`);

  // A blank buyer defaulted to the channel label — don't echo that as a name.
  const buyerName =
    note.party.name === CHANNEL_LABELS[note.channel] ? "" : note.party.name;

  return (
    <div>
      <h1 className="heading text-xl font-semibold mb-4">Edit Delivery Note</h1>
      <DeliveryForm
        action={updateDelivery.bind(null, note.id)}
        initial={{
          channel: note.channel,
          buyerName,
          vehicleNo: note.vehicleNo,
          date: toInputDate(note.date),
        }}
        submitLabel="Save Changes"
      />
    </div>
  );
}
