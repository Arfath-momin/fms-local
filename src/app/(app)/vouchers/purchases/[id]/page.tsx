import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { canEdit, canEnter, requireSession } from "@/lib/session";
import { fmtDate, fmtKg, fmtMoney, toInputDate } from "@/lib/format";
import { updatePurchase } from "../actions";
import { PurchaseForm, type PurchaseInit } from "../purchase-form";
import { getAttachments } from "@/lib/attachments";
import { uploadAttachment } from "../../../attachments/actions";
import { AttachmentPanel } from "../../../attachments/attachment-panel";
import { VoucherMeta } from "../../voucher-meta";

export default async function PurchaseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireSession();
  const mayEdit = canEdit(session.role);
  const mayEnter = canEnter(session.role);

  const { id } = await params;
  const purchase = await prisma.purchase.findUnique({
    where: { id },
    include: {
      party: { select: { name: true } },
      boat: { select: { name: true } },
      lines: { orderBy: { id: "asc" } },
      createdBy: { select: { name: true } },
      updatedBy: { select: { name: true } },
    },
  });
  if (!purchase) notFound();

  // Historic flags from the old closed-day correction flow are still honoured:
  // the original stays visible and points at whatever replaced it.
  const flag = await prisma.errorFlag.findUnique({
    where: {
      linkedType_linkedId: { linkedType: "PURCHASE", linkedId: purchase.id },
    },
  });

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
      canUpload={mayEnter}
    />
  );

  const meta = (
    <VoucherMeta
      createdBy={purchase.createdBy}
      createdAt={purchase.createdAt}
      updatedBy={purchase.updatedBy}
      updatedAt={purchase.updatedAt}
    />
  );

  // Only an administrator may change a voucher after it is saved. Everyone else
  // who can reach this page sees the same figures, read-only.
  if (!mayEdit) {
    return (
      <div>
        <h1 className="heading text-xl font-semibold mb-4">Purchase</h1>
        <dl className="border border-line-strong bg-surface divide-y divide-line max-w-lg text-[13px]">
          <Row label="Type" value={purchase.type} />
          <Row label="Party (ledger)" value={purchase.party.name} />
          <Row
            label={purchase.type === "LOCAL" ? "Seller" : "Boat"}
            value={purchase.boat?.name ?? "—"}
          />
          <Row label="Date" value={fmtDate(purchase.date)} />
          <Row label="Amount" value={fmtMoney(purchase.amount)} />
        </dl>

        {purchase.lines.length > 0 && (
          <div className="border border-line-strong bg-surface mt-4 max-w-lg">
            <table className="ledger-table">
              <thead>
                <tr>
                  <th>Particular</th>
                  <th className="num-col">Qty</th>
                  <th className="num-col">Rate</th>
                  <th className="num-col">Total</th>
                </tr>
              </thead>
              <tbody>
                {purchase.lines.map((l) => (
                  <tr key={l.id}>
                    <td>{l.particular}</td>
                    <td className="num-col">{fmtKg(l.qtyKg)}</td>
                    <td className="num-col">{fmtMoney(l.pricePerKg)}</td>
                    <td className="num-col">{fmtMoney(l.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {meta}
        {panel}
      </div>
    );
  }

  const initial: PurchaseInit = {
    type: purchase.type,
    partyName: purchase.party.name,
    boatName: purchase.boat?.name ?? "",
    amount: purchase.amount.toString(),
    date: toInputDate(purchase.date),
    lines: purchase.lines.map((l) => ({
      particular: l.particular,
      qtyKg: l.qtyKg.toString(),
      pricePerKg: l.pricePerKg.toString(),
    })),
  };

  return (
    <div>
      <h1 className="heading text-xl font-semibold mb-4">Edit Purchase</h1>
      <PurchaseForm
        action={updatePurchase.bind(null, purchase.id)}
        initial={initial}
        submitLabel="Save Changes"
      />
      {meta}
      {panel}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 px-4 py-2">
      <dt className="text-muted">{label}</dt>
      <dd className="font-semibold">{value}</dd>
    </div>
  );
}
