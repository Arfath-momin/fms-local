import Link from "next/link";
import { notFound } from "next/navigation";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { getActiveScope } from "@/lib/centre";
import { canEdit, canEnter, requireSession } from "@/lib/session";
import { SALE_TYPE_LABELS } from "@/lib/sale";
import { fmtDate, fmtMoney } from "@/lib/format";
import { getAttachments } from "@/lib/attachments";
import { uploadAttachment } from "../../../attachments/actions";
import { AttachmentPanel } from "../../../attachments/attachment-panel";
import { DeleteVoucher } from "../../delete-voucher";
import { ReviewPanel } from "../../review-panel";
import { VoucherMeta } from "../../voucher-meta";
import { deleteSale } from "../actions";

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

export default async function SalePage({
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

  const sale = await prisma.sale.findFirst({
    // Scoped, not just found by id. A voucher belonging to another company or
    // centre must not open — let alone be editable — from the scope you are in.
    where: { id, companyId: company.id, centreId: centre.id },
    include: {
      company: { select: { name: true } },
      centre: { select: { name: true } },
      party: { select: { name: true } },
      careOfParty: { select: { name: true } },
      lines: { orderBy: { id: "asc" } },
      createdBy: { select: { name: true } },
      updatedBy: { select: { name: true } },
    },
  });
  if (!sale) notFound();

  // Collection is tracked against the party, not this bill, so the meaningful
  // figure alongside the sale is what the ledger party currently owes overall.
  const ledgerPartyId = sale.careOfPartyId ?? sale.partyId;
  const latest = await prisma.ledgerEntry.findFirst({
    where: {
      companyId: sale.companyId,
      centreId: sale.centreId,
      partyId: ledgerPartyId,
    },
    orderBy: [{ date: "desc" }, { seq: "desc" }],
    select: { runningBalance: true },
  });
  const outstanding = latest?.runningBalance ?? new Prisma.Decimal(0);
  const attachments = await getAttachments("SALE", sale.id);
  const isFishMill = sale.type === "FISH_MILL";

  return (
    <div className="max-w-3xl">
      <Link
        href="/vouchers/sales"
        className="text-muted text-[12px] underline underline-offset-2"
      >
        ← Sales
      </Link>
      <div className="flex items-end justify-between flex-wrap gap-3 mt-1 mb-4">
        <div>
          <h1 className="heading text-xl font-semibold">
            {SALE_TYPE_LABELS[sale.type]} Sale · {sale.billNo}
          </h1>
          <p className="text-muted text-[13px]">
            {sale.company.name} · {sale.centre.name}
            {sale.careOfParty && (
              <> · ledger posted to CareOf {sale.careOfParty.name}</>
            )}
          </p>
        </div>
        <div className="flex gap-2">
          {/* Opens the bill as a document — the browser's print dialog is also
              where "Save as PDF" lives, so this covers printing and sending. */}
          <Link
            href={`/vouchers/sales/${sale.id}/print`}
            className="border border-line-strong bg-surface px-4 py-2 text-[13px] font-semibold hover:border-accent"
          >
            Bill
          </Link>
          {mayEdit && (
            <Link
              href={`/vouchers/sales/${sale.id}/edit`}
              className="border border-line-strong bg-surface px-4 py-2 text-[13px] font-semibold hover:border-accent"
            >
              Edit
            </Link>
          )}
        </div>
      </div>

      <div className="border border-line-strong bg-surface px-4 py-3 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 mb-4">
        <Field label="Bill No." value={sale.billNo} />
        <Field label="Purchase Date" value={fmtDate(sale.date)} />
        <Field
          label="Sale Date"
          value={fmtDate(sale.saleDate ?? sale.date)}
        />
        <Field
          label={sale.type === "MARKET" ? "Seller" : "Party"}
          value={sale.party.name}
        />
        {sale.careOfParty && <Field label="CareOf" value={sale.careOfParty.name} />}
        {sale.place && <Field label="Place" value={sale.place} />}
        {sale.vehicleNo && <Field label="Vehicle No." value={sale.vehicleNo} />}
        {sale.weight && <Field label="Weight" value={sale.weight.toString()} />}
        {sale.netWeight && (
          <Field label="Net Weight" value={sale.netWeight.toString()} />
        )}
        {sale.placeOfLoading && (
          <Field label="Place of Loading" value={sale.placeOfLoading} />
        )}
        {sale.returnNote && <Field label="Return" value={sale.returnNote} />}
        {sale.totalBill && (
          <Field label="Total Bill" value={fmtMoney(sale.totalBill)} />
        )}
        {sale.commission && (
          <Field label="Commission (2%)" value={fmtMoney(sale.commission)} />
        )}
      </div>

      {sale.lines.length > 0 && (
        <div className="border border-line-strong bg-surface mb-4 overflow-x-auto">
          <table className="ledger-table">
            <thead>
              <tr>
                {isFishMill && <th className="num-col">Box</th>}
                <th>{isFishMill ? "Fish (variety)" : "Particular"}</th>
                <th className="num-col">Kgs</th>
                <th className="num-col">Rate/kg</th>
                {isFishMill && <th className="num-col">Count</th>}
                <th className="num-col">Total</th>
              </tr>
            </thead>
            <tbody>
              {sale.lines.map((l) => (
                <tr key={l.id}>
                  {isFishMill && <td className="num-col num">{l.box ?? "—"}</td>}
                  <td className="font-medium">{l.particular}</td>
                  <td className="num-col num">{l.qtyKg.toString()}</td>
                  <td className="num-col num">{fmtMoney(l.ratePerKg)}</td>
                  {isFishMill && <td className="num-col num">{l.count ?? "—"}</td>}
                  <td className="num-col num">{fmtMoney(l.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="border border-line-strong bg-surface px-4 py-3 grid grid-cols-1 sm:grid-cols-2 gap-3 mb-2">
        <Field label="Sale Amount" value={fmtMoney(sale.amount)} />
        <div>
          <div className="text-[11px] uppercase tracking-wide text-muted font-semibold">
            {(sale.careOfParty ?? sale.party).name} owes (all bills)
          </div>
          <div
            className={`num text-[14px] font-semibold ${
              outstanding.greaterThan(0) ? "text-debit" : "text-muted"
            }`}
          >
            {fmtMoney(outstanding)}
          </div>
          <Link
            href="/vouchers/receipts/new"
            className="text-accent underline underline-offset-2 text-[12px]"
          >
            Record a receipt
          </Link>
        </div>
      </div>

      <AttachmentPanel
        attachments={attachments.map((a) => ({
          id: a.id,
          uploadedAt: a.uploadedAt.toISOString(),
        }))}
        action={uploadAttachment.bind(
          null,
          "SALE",
          sale.id,
          `/vouchers/sales/${sale.id}`
        )}
        canUpload={mayEnter}
      />

      <VoucherMeta
        createdBy={sale.createdBy}
        createdAt={sale.createdAt}
        updatedBy={sale.updatedBy}
        updatedAt={sale.updatedAt}
      />

      <ReviewPanel linkedType="SALE" linkedId={sale.id} noun="sale" />

      {mayEdit && (
        <DeleteVoucher
          action={deleteSale.bind(null, sale.id)}
          noun="sale"
          warning={
            sale.commission
              ? "The buyer's ledger entry and the 2% commission entry both go with it, and each affected running balance is rebuilt without them."
              : undefined
          }
        />
      )}
    </div>
  );
}
