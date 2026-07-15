import Link from "next/link";
import { notFound } from "next/navigation";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { ledgerDelta } from "@/lib/ledger";
import { CHANNEL_LABELS } from "@/lib/delivery";
import { fmtDate, fmtKg, fmtMoney } from "@/lib/format";
import { StatusBadge } from "../status-badge";

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

  // Previous outstanding balance (spec §5): the party's balance from
  // everything EXCEPT this note's own settlements.
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

  const settled = note.settlements.reduce(
    (acc, s) => acc.add(s.qtyAccepted).add(s.qtyReturned).add(s.qtySpoiled),
    new Prisma.Decimal(0)
  );
  const remaining = note.qtySent.sub(settled);

  return (
    <div className="max-w-3xl">
      <Link
        href="/vouchers/deliveries"
        className="text-muted text-[12px] underline underline-offset-2"
      >
        ← Delivery Notes
      </Link>

      <div className="border border-line-strong bg-surface mt-2">
        {/* Document header */}
        <div className="px-6 py-4 border-b border-line flex items-start justify-between">
          <div>
            <h1 className="heading text-lg font-semibold">Delivery Note</h1>
            <p className="text-muted text-[13px]">
              {fmtDate(note.date)} · {CHANNEL_LABELS[note.channel]}
            </p>
          </div>
          <StatusBadge status={note.status} />
        </div>

        {/* Party + previous balance — the hard UI requirement (spec §5) */}
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

        {/* Note line */}
        <div className="px-6 py-4 border-b border-line">
          <table className="ledger-table">
            <thead>
              <tr>
                <th>Fish Type</th>
                <th className="num-col">Qty Sent</th>
                <th className="num-col">Rate (locked)</th>
                <th className="num-col">Expected Value</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="font-medium">{note.fishType}</td>
                <td className="num-col num">{fmtKg(note.qtySent)}</td>
                <td className="num-col num">{fmtMoney(note.rate)}</td>
                <td className="num-col num font-semibold">
                  {fmtMoney(note.expectedValue)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Settlements */}
        <div className="px-6 py-4">
          <div className="flex items-center justify-between mb-2">
            <h2 className="heading text-[15px] font-semibold">Settlements</h2>
            {isMerchant && note.status !== "SETTLED" && (
              <Link
                href={`/vouchers/deliveries/${note.id}/settle`}
                className="bg-accent text-white px-3 py-1.5 text-[12px] font-semibold"
              >
                New Settlement
              </Link>
            )}
          </div>

          {note.settlements.length === 0 ? (
            <p className="text-muted text-[13px]">
              No settlements yet — the full {fmtKg(note.qtySent)} is still in
              transit.
            </p>
          ) : (
            <table className="ledger-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th className="num-col">Accepted</th>
                  <th className="num-col">Returned</th>
                  <th className="num-col">Spoiled</th>
                  <th className="num-col">Expected</th>
                  <th className="num-col">Received</th>
                  <th className="num-col">Variance</th>
                </tr>
              </thead>
              <tbody>
                {note.settlements.map((s) => {
                  const expected = s.qtyAccepted.mul(note.rate);
                  const paid = s.gross ?? s.amountReceived;
                  const variance = expected.sub(paid);
                  return (
                    <tr key={s.id}>
                      <td className="whitespace-nowrap">{fmtDate(s.date)}</td>
                      <td className="num-col num">{fmtKg(s.qtyAccepted)}</td>
                      <td className="num-col num">{fmtKg(s.qtyReturned)}</td>
                      <td className="num-col num text-debit">
                        {fmtKg(s.qtySpoiled)}
                      </td>
                      <td className="num-col num">{fmtMoney(expected)}</td>
                      <td className="num-col num text-credit">
                        {fmtMoney(s.amountReceived)}
                      </td>
                      <td className="num-col num">
                        {variance.greaterThan(0) ? (
                          <span className="text-debit font-semibold">
                            {fmtMoney(variance)}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          {remaining.greaterThan(0) && note.settlements.length > 0 && (
            <p className="text-[13px] mt-2">
              <span className="font-semibold num">{fmtKg(remaining)}</span>{" "}
              still unsettled.
            </p>
          )}
        </div>
      </div>

      {isMerchant && note.status === "PENDING" && (
        <p className="mt-3 text-[13px]">
          <Link
            href={`/vouchers/deliveries/${note.id}/edit`}
            className="text-accent underline underline-offset-2"
          >
            Edit this delivery note
          </Link>{" "}
          <span className="text-muted">
            (possible only until the first settlement)
          </span>
        </p>
      )}
    </div>
  );
}
