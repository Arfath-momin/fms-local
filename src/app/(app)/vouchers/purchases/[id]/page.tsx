import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { toInputDate } from "@/lib/format";
import { correctPurchase, updatePurchase } from "../actions";
import { PurchaseForm, type PurchaseInit } from "../purchase-form";
import { getAttachments } from "@/lib/attachments";
import { uploadAttachment } from "../../../attachments/actions";
import { AttachmentPanel } from "../../../attachments/attachment-panel";

export default async function EditPurchasePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireSession();
  if (session.role !== "MERCHANT") redirect("/vouchers/purchases");

  const { id } = await params;
  const purchase = await prisma.purchase.findUnique({
    where: { id },
    include: {
      party: { select: { name: true } },
      lines: { orderBy: { id: "asc" } },
    },
  });
  if (!purchase) notFound();

  const [dayClose, flag] = await Promise.all([
    prisma.dayClose.findUnique({
      where: {
        companyId_centreId_date: {
          companyId: purchase.companyId,
          centreId: purchase.centreId,
          date: purchase.date,
        },
      },
    }),
    prisma.errorFlag.findUnique({
      where: {
        linkedType_linkedId: { linkedType: "PURCHASE", linkedId: purchase.id },
      },
    }),
  ]);

  if (flag) {
    return (
      <div>
        <h1 className="heading text-xl font-semibold mb-4">Purchase</h1>
        <div className="text-[13px] border border-debit bg-surface px-4 py-3 max-w-lg">
          <p className="font-semibold text-debit">
            This purchase was flagged as an error and corrected.
          </p>
          {flag.reason && <p className="mt-1 text-muted">Reason: {flag.reason}</p>}
          {flag.correctingEntryId && (
            <p className="mt-1">
              <Link
                href={`/vouchers/purchases/${flag.correctingEntryId}`}
                className="text-accent underline underline-offset-2"
              >
                View the corrected entry →
              </Link>
            </p>
          )}
        </div>
      </div>
    );
  }

  const initial: PurchaseInit = {
    type: purchase.type,
    partyName: purchase.party.name,
    amount: purchase.amount.toString(),
    paid: purchase.paid,
    date: toInputDate(purchase.date),
    lines: purchase.lines.map((l) => ({
      particular: l.particular,
      qtyKg: l.qtyKg.toString(),
      pricePerKg: l.pricePerKg.toString(),
    })),
  };

  const attachments = await getAttachments("PURCHASE", purchase.id);
  const panel = (
    <AttachmentPanel
      attachments={attachments.map((a) => ({
        id: a.id,
        uploadedAt: a.uploadedAt.toISOString(),
      }))}
      action={uploadAttachment.bind(
        null,
        "PURCHASE",
        purchase.id,
        `/vouchers/purchases/${purchase.id}`
      )}
      canUpload
    />
  );

  if (dayClose) {
    return (
      <div>
        <h1 className="heading text-xl font-semibold mb-1">
          Correct Purchase (closed day)
        </h1>
        <p className="text-[13px] text-muted mb-4 max-w-lg">
          This day is closed, so the original entry cannot be edited. Saving here
          flags the original as an error — it stays visible, struck-through — and
          records this corrected entry in its place.
        </p>
        <PurchaseForm
          action={correctPurchase.bind(null, purchase.id)}
          initial={initial}
          submitLabel="Flag Original & Save Correction"
          reasonField
        />
        {panel}
      </div>
    );
  }

  return (
    <div>
      <h1 className="heading text-xl font-semibold mb-4">Edit Purchase</h1>
      <PurchaseForm
        action={updatePurchase.bind(null, purchase.id)}
        initial={initial}
        submitLabel="Save Changes"
      />
      {panel}
    </div>
  );
}
