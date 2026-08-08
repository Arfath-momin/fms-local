import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getActiveScope } from "@/lib/centre";
import { canEdit, canEnter, requireSession } from "@/lib/session";
import { sumDeliveryLines } from "@/lib/delivery";
import { fmtDate, fmtMoney } from "@/lib/format";
import { getAttachments } from "@/lib/attachments";
import { uploadAttachment } from "../../../attachments/actions";
import { AttachmentPanel } from "../../../attachments/attachment-panel";
import { DeleteVoucher } from "../../delete-voucher";
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
      company: { select: { name: true } },
      centre: { select: { name: true } },
      lines: { orderBy: { id: "asc" } },
      createdBy: { select: { name: true } },
      updatedBy: { select: { name: true } },
    },
  });
  if (!note) notFound();

  const totals = sumDeliveryLines(note.lines);
  const attachments = await getAttachments("DELIVERY_NOTE", note.id);

  return (
    <div className="max-w-3xl">
      <Link
        href="/vouchers/deliveries"
        className="text-muted text-[12px] underline underline-offset-2"
      >
        ← Delivery Notes
      </Link>
      <div className="flex items-end justify-between mt-1 mb-4">
        <div>
          <h1 className="heading text-xl font-semibold">
            Delivery Note · {note.billNo}
          </h1>
          <p className="text-muted text-[13px]">
            {note.company.name} · {note.centre.name} · record only
          </p>
        </div>
        {mayEdit && (
          <Link
            href={`/vouchers/deliveries/${note.id}/edit`}
            className="border border-line-strong bg-surface px-4 py-2 text-[13px] font-semibold hover:border-accent"
          >
            Edit
          </Link>
        )}
      </div>

      <div className="border border-line-strong bg-surface px-4 py-3 grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
        <Field label="Bill No." value={note.billNo} />
        <Field label="Date" value={fmtDate(note.date)} />
        <Field label="To" value={note.recipient} />
        <Field label="Vehicle No." value={note.vehicleNo} />
        <Field
          label="Advance Paid"
          value={note.advancePaid ? fmtMoney(note.advancePaid) : "—"}
        />
        <Field label="Driver Name" value={note.driverName ?? "—"} />
        <Field label="Mobile No." value={note.mobileNo ?? "—"} />
      </div>

      <div className="border border-line-strong bg-surface">
        <table className="ledger-table">
          <thead>
            <tr>
              <th>Particulars</th>
              <th className="num-col">Kg</th>
              <th className="num-col">Box</th>
              <th className="num-col">Big Box</th>
              <th className="num-col">Loose</th>
              <th className="num-col">Pcs</th>
            </tr>
          </thead>
          <tbody>
            {note.lines.map((l) => (
              <tr key={l.id}>
                <td className="font-medium">{l.particulars}</td>
                <td className="num-col num">{l.kg.toString()}</td>
                <td className="num-col num">{l.box}</td>
                <td className="num-col num">{l.bigBox}</td>
                <td className="num-col num">{l.loose}</td>
                <td className="num-col num">{l.pcs}</td>
              </tr>
            ))}
            <tr className="border-t border-line-strong font-semibold">
              <td className="text-right">Total</td>
              <td className="num-col num">{totals.kg.toString()}</td>
              <td className="num-col num">{totals.box}</td>
              <td className="num-col num">{totals.bigBox}</td>
              <td className="num-col num">{totals.loose}</td>
              <td className="num-col num">{totals.pcs}</td>
            </tr>
          </tbody>
        </table>
      </div>

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
