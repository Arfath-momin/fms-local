import Link from "next/link";
import { notFound } from "next/navigation";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { ledgerDelta } from "@/lib/ledger";
import { CHANNEL_LABELS } from "@/lib/delivery";
import { fmtDate, fmtMoney } from "@/lib/format";
import { StatusBadge } from "../status-badge";
import { getAttachments } from "@/lib/attachments";
import { uploadAttachment } from "../../../attachments/actions";
import { AttachmentPanel } from "../../../attachments/attachment-panel";

export default async function DeliveryNotePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireSession();
  const isMerchant = session.role === "MERCHANT";
  const { id } = await params;

  const note = await prisma.deliveryNote.findUnique({
    where: { id },
    include: {
      party: true,
      settlements: { orderBy: [{ date: "asc" }, { createdAt: "asc" }] },
    },
  });
  if (!note) notFound();

  // Previous outstanding balance: the buyer's balance from everything EXCEPT
  // this note's own settlements.
  const [lastEntry, ownEntries] = await Promise.all([
    prisma.ledgerEntry.findFirst({
      where: { companyId: note.companyId, partyId: note.partyId },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      select: { runningBalance: true },
    }),
    prisma.ledgerEntry.findMany({
      where: {
        companyId: note.companyId,
        partyId: note.partyId,
        sourceId: { in: note.settlements.map((s) => s.id) },
      },
      select: { type: true, amount: true },
    }),
  ]);
  const currentBalance = lastEntry?.runningBalance ?? new Prisma.Decimal(0);
  let ownEffect = new Prisma.Decimal(0);
  for (const e of ownEntries) ownEffect = ownEffect.add(ledgerDelta(e.type, e.amount));
  const previousBalance = currentBalance.sub(ownEffect);

  const settlementImages = await Promise.all(
    note.settlements.map((s) => getAttachments("SETTLEMENT", s.id))
  );

  return (
    <div className="max-w-3xl">
      <Link
        href="/vouchers/deliveries"
        className="text-muted text-[12px] underline underline-offset-2"
      >
        ← Delivery Notes
      </Link>

      <div className="border border-line-strong bg-surface mt-2">
        <div className="px-6 py-4 border-b border-line flex items-start justify-between">
          <div>
            <h1 className="heading text-lg font-semibold">Delivery Note</h1>
            <p className="text-muted text-[13px]">
              {fmtDate(note.date)} · {CHANNEL_LABELS[note.channel]} · Vehicle{" "}
              <span className="num">{note.vehicleNo}</span>
            </p>
          </div>
          <StatusBadge status={note.status} />
        </div>

        <div className="px-6 py-4 border-b border-line flex items-center justify-between">
          <div>
            <div className="text-[12px] uppercase tracking-wide text-muted font-semibold">
              Buyer
            </div>
            <div className="text-[15px] font-medium">{note.party.name}</div>
          </div>
          <div className="text-right">
            <div className="text-[12px] uppercase tracking-wide text-muted font-semibold">
              Previous Outstanding Balance
            </div>
            <div
              className={`num text-xl font-bold ${
                previousBalance.greaterThan(0) ? "text-debit" : "text-credit"
              }`}
            >
              {fmtMoney(previousBalance)}
            </div>
            {previousBalance.greaterThan(0) && (
              <div className="text-debit text-[12px]">
                owed to us before this delivery
              </div>
            )}
          </div>
        </div>

        <div className="px-6 py-4">
          <div className="flex items-center justify-between mb-2">
            <h2 className="heading text-[15px] font-semibold">Settlement</h2>
            {isMerchant && note.status !== "SETTLED" && (
              <Link
                href={`/vouchers/deliveries/${note.id}/settle`}
                className="bg-accent text-white px-3 py-1.5 text-[12px] font-semibold"
              >
                Settle (add bill)
              </Link>
            )}
          </div>

          {note.settlements.length === 0 ? (
            <p className="text-muted text-[13px]">
              Not settled yet — no bill recorded.
            </p>
          ) : (
            <table className="ledger-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th className="num-col">Total Amount</th>
                  <th className="num-col">Received</th>
                  <th>Balance</th>
                  <th>Bill Image</th>
                </tr>
              </thead>
              <tbody>
                {note.settlements.map((s, i) => {
                  const settleBalance = s.amount.sub(s.amountReceived);
                  return (
                  <tr key={s.id}>
                    <td className="whitespace-nowrap">{fmtDate(s.date)}</td>
                    <td className="num-col num text-credit font-semibold">
                      {fmtMoney(s.amount)}
                    </td>
                    <td className="num-col num">{fmtMoney(s.amountReceived)}</td>
                    <td>
                      {settleBalance.greaterThan(0) ? (
                        <span className="text-debit text-[12px] font-semibold">
                          {fmtMoney(settleBalance)}
                        </span>
                      ) : (
                        <span className="text-muted text-[12px]">Settled</span>
                      )}
                    </td>
                    <td>
                      {settlementImages[i].length === 0 ? (
                        <span className="text-muted text-[12px]">—</span>
                      ) : (
                        settlementImages[i].map((a) => (
                          <a
                            key={a.id}
                            href={`/api/attachments/${a.id}`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-accent underline underline-offset-2 text-[12px] mr-2"
                          >
                            view
                          </a>
                        ))
                      )}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <AttachmentPanel
        attachments={(await getAttachments("DELIVERY_NOTE", note.id)).map((a) => ({
          id: a.id,
          uploadedAt: a.uploadedAt.toISOString(),
        }))}
        action={uploadAttachment.bind(
          null,
          "DELIVERY_NOTE",
          note.id,
          note.companyId,
          `/vouchers/deliveries/${note.id}`
        )}
        canUpload={isMerchant}
      />

      {isMerchant && note.status === "PENDING" && (
        <p className="mt-3 text-[13px]">
          <Link
            href={`/vouchers/deliveries/${note.id}/edit`}
            className="text-accent underline underline-offset-2"
          >
            Edit this delivery note
          </Link>{" "}
          <span className="text-muted">(possible only until it is settled)</span>
        </p>
      )}
    </div>
  );
}
