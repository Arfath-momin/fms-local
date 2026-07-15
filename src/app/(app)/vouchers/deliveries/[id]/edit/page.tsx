import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { getStockSummary } from "@/lib/stock";
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
  if (session.role !== "MERCHANT") redirect(`/vouchers/deliveries/${id}`);

  const note = await prisma.deliveryNote.findUnique({
    where: { id },
    include: { _count: { select: { settlements: true } } },
  });
  if (!note) notFound();
  if (note.status !== "PENDING" || note._count.settlements > 0)
    redirect(`/vouchers/deliveries/${id}`);

  const [buyers, stock] = await Promise.all([
    prisma.party.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, type: true },
    }),
    getStockSummary(note.companyId),
  ]);

  // Editing frees this note's own qty, so add it back to what's selectable.
  const fishOptions = stock
    .map((s) => ({
      fishType: s.fishType,
      available: (s.fishType === note.fishType
        ? s.available.add(note.qtySent)
        : s.available
      ).toString(),
    }))
    .filter((s) => Number(s.available) > 0);

  return (
    <div>
      <h1 className="heading text-xl font-semibold mb-4">Edit Delivery Note</h1>
      <DeliveryForm
        action={updateDelivery.bind(null, note.id)}
        buyers={buyers}
        fishOptions={fishOptions}
        initial={{
          channel: note.channel,
          partyId: note.partyId,
          fishType: note.fishType,
          qtySent: note.qtySent.toString(),
          rate: note.rate.toString(),
          date: toInputDate(note.date),
        }}
        submitLabel="Save Changes"
      />
    </div>
  );
}
