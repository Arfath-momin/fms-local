import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getActiveScope, scopeFieldValues } from "@/lib/centre";
import { canEdit, canEnter, requireSession } from "@/lib/session";
import { fmtDate, fmtKg, fmtMoney, toInputDate } from "@/lib/format";
import { PURCHASE_TYPE_LABELS } from "@/lib/purchase";
import { purchaseHasLineBoats, purchasePartyIsTyped } from "@/lib/party";
import { deletePurchase, updatePurchase } from "../actions";
import { PurchaseForm, type PurchaseInit } from "../purchase-form";
import { getAttachments } from "@/lib/attachments";
import { uploadAttachment } from "../../../attachments/actions";
import { AttachmentPanel } from "../../../attachments/attachment-panel";
import { DeleteVoucher } from "../../delete-voucher";
import { ReviewPanel } from "../../review-panel";
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
  const { company, centre } = await getActiveScope();
  if (!centre) notFound();

  const purchase = await prisma.purchase.findFirst({
    // Scoped, not just found by id. A voucher belonging to another company or
    // centre must not open — let alone be editable — from the scope you are in.
    where: { id, companyId: company.id, centreId: centre.id },
    include: {
      party: { select: { name: true } },
      lines: {
        orderBy: { id: "asc" },
        include: { boat: { select: { name: true } } },
      },
      createdBy: { select: { name: true } },
      updatedBy: { select: { name: true } },
    },
  });
  if (!purchase) notFound();


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

  // The accountant's route to a correction, since they cannot edit. For an
  // admin this is the notice that one was asked for — rendered above the form
  // there, where it explains why they are on this screen.
  const review = (
    <ReviewPanel linkedType="PURCHASE" linkedId={purchase.id} noun="purchase" />
  );

  // Society / KFDC name a boat on every row; Private and Local name their
  // seller once, as the party, so there is no boat column to show.
  const showLineBoats = purchaseHasLineBoats(purchase.type);

  // Only an administrator may change a voucher after it is saved. Everyone else
  // who can reach this page sees the same figures, read-only.
  if (!mayEdit) {
    return (
      <div>
        <div className="flex items-start justify-between gap-4 mb-4">
          <h1 className="heading text-xl font-semibold">Purchase</h1>
        {/* Opens the purchase as a document — the browser's print dialog is
            also where "Save as PDF" lives, so this covers printing and keeping
            a copy. Offered on the read-only view too: an auditor may not edit a
            voucher but still has every reason to print one. */}
        <Link
          href={`/vouchers/purchases/${purchase.id}/print`}
          className="border border-line-strong bg-surface px-4 py-2 text-[13px] font-semibold hover:border-accent"
        >
          Print
        </Link>
        </div>
        <dl className="border border-line-strong bg-surface divide-y divide-line max-w-lg text-[13px]">
          <Row label="Type" value={PURCHASE_TYPE_LABELS[purchase.type]} />
          <Row
            label={purchasePartyIsTyped(purchase.type) ? "Invoice No." : "No."}
            value={purchase.billNo ?? "—"}
          />
          <Row label="Owed to" value={purchase.party.name} />
          <Row label="Date" value={fmtDate(purchase.date)} />
          <Row label="Total Amount" value={fmtMoney(purchase.amount)} />
        </dl>

        {purchase.lines.length > 0 && (
          <div className="border border-line-strong bg-surface mt-4 max-w-2xl">
            <table className="ledger-table">
              <thead>
                <tr>
                  <th className="num-col">Sl</th>
                  {showLineBoats && <th>Boat Name</th>}
                  <th>{showLineBoats ? "Particulars" : "Particular"}</th>
                  <th className="num-col">{showLineBoats ? "Total Kg" : "Qty"}</th>
                  <th className="num-col">{showLineBoats ? "Rate/kg" : "Rate"}</th>
                  <th className="num-col">Amount</th>
                </tr>
              </thead>
              <tbody>
                {purchase.lines.map((l, i) => (
                  <tr key={l.id}>
                    <td className="num-col num text-muted">{i + 1}</td>
                    {showLineBoats && (
                      <td>{l.boat?.name ?? <span className="text-muted">—</span>}</td>
                    )}
                    <td>{l.particular}</td>
                    <td className="num-col">{fmtKg(l.qtyKg)}</td>
                    <td className="num-col">{fmtMoney(l.pricePerKg)}</td>
                    <td className="num-col">{fmtMoney(l.total)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-line-strong font-semibold">
                  <td colSpan={showLineBoats ? 5 : 4} className="text-right">
                    Total Amount
                  </td>
                  <td className="num-col num text-debit">
                    {fmtMoney(purchase.amount)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {meta}
        {panel}
        {review}
      </div>
    );
  }

  const initial: PurchaseInit = {
    type: purchase.type,
    billNo: purchase.billNo ?? "",
    partyName: purchase.party.name,
    date: toInputDate(purchase.date),
    notes: purchase.notes ?? "",
    lines: purchase.lines.map((l) => ({
      boatName: l.boat?.name ?? "",
      particular: l.particular,
      qtyKg: l.qtyKg.toString(),
      pricePerKg: l.pricePerKg.toString(),
    })),
  };

  return (
    <div>
      <div className="flex items-start justify-between gap-4 mb-4">
        <h1 className="heading text-xl font-semibold">Edit Purchase</h1>
        {/* Opens the purchase as a document — the browser's print dialog is
            also where "Save as PDF" lives, so this covers printing and keeping
            a copy. Offered on the read-only view too: an auditor may not edit a
            voucher but still has every reason to print one. */}
        <Link
          href={`/vouchers/purchases/${purchase.id}/print`}
          className="border border-line-strong bg-surface px-4 py-2 text-[13px] font-semibold hover:border-accent"
        >
          Print
        </Link>
      </div>
      {/* Above the form, not below it: it is the reason this screen is open.
          Collapses to nothing when no review was requested. */}
      <div className="mb-4 empty:hidden [&>*]:mt-0">{review}</div>
      <PurchaseForm
        action={updatePurchase.bind(null, purchase.id)}
        initial={initial}
        submitLabel="Save Changes"
        scope={scopeFieldValues({ company, centre })}
        // The Attachments panel below is the single place images are managed
        // once the voucher exists.
        allowBillUpload={false}
      />
      {meta}
      {panel}
      <DeleteVoucher
        action={deletePurchase.bind(null, purchase.id)}
        noun="purchase"
      />
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
