import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { SALE_TYPE_LABELS } from "@/lib/sale";
import { fmtDate, fmtMoney } from "@/lib/format";
import { getAttachments } from "@/lib/attachments";
import { uploadAttachment } from "../../../attachments/actions";
import { AttachmentPanel } from "../../../attachments/attachment-panel";

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
  const isMerchant = session.role === "MERCHANT";
  const { id } = await params;

  const sale = await prisma.sale.findUnique({
    where: { id },
    include: {
      company: { select: { name: true } },
      centre: { select: { name: true } },
      party: { select: { name: true } },
      careOfParty: { select: { name: true } },
      lines: { orderBy: { id: "asc" } },
    },
  });
  if (!sale) notFound();

  const dayClose = await prisma.dayClose.findUnique({
    where: {
      companyId_centreId_date: {
        companyId: sale.companyId,
        centreId: sale.centreId,
        date: sale.date,
      },
    },
  });
  const balance = sale.amount.sub(sale.amountReceived);
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
      <div className="flex items-end justify-between mt-1 mb-4">
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
        {isMerchant &&
          (dayClose ? (
            <span className="text-[12px] text-muted">🔒 Day closed</span>
          ) : (
            <Link
              href={`/vouchers/sales/${sale.id}/edit`}
              className="border border-line-strong bg-surface px-4 py-2 text-[13px] font-semibold hover:border-accent"
            >
              Edit
            </Link>
          ))}
      </div>

      <div className="border border-line-strong bg-surface px-4 py-3 grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
        <Field label="Bill No." value={sale.billNo} />
        <Field label="Date" value={fmtDate(sale.date)} />
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
        <div className="border border-line-strong bg-surface mb-4">
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

      <div className="border border-line-strong bg-surface px-4 py-3 grid grid-cols-3 gap-3 mb-2">
        <Field label="Sale Amount" value={fmtMoney(sale.amount)} />
        <Field label="Received" value={fmtMoney(sale.amountReceived)} />
        <div>
          <div className="text-[11px] uppercase tracking-wide text-muted font-semibold">
            Balance
          </div>
          <div
            className={`num text-[14px] font-semibold ${
              balance.greaterThan(0) ? "text-debit" : ""
            }`}
          >
            {fmtMoney(balance)}
          </div>
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
        canUpload={isMerchant}
      />
    </div>
  );
}
