import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { CHANNEL_LABELS } from "@/lib/delivery";
import { fmtDate, fmtKg, fmtMoney } from "@/lib/format";
import { createSettlement } from "../../actions";
import { SettleForm } from "./settle-form";

export default async function SettlePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireSession();
  const { id } = await params;
  if (session.role !== "MERCHANT") redirect(`/vouchers/deliveries/${id}`);

  const note = await prisma.deliveryNote.findUnique({
    where: { id },
    include: { party: true, settlements: true },
  });
  if (!note) notFound();
  if (note.status === "SETTLED") redirect(`/vouchers/deliveries/${id}`);

  // Previous outstanding balance, shown before the entry (spec §5)
  const lastEntry = await prisma.ledgerEntry.findFirst({
    where: { companyId: note.companyId, partyId: note.partyId },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    select: { runningBalance: true },
  });
  const balance = lastEntry?.runningBalance ?? new Prisma.Decimal(0);

  const settled = note.settlements.reduce(
    (acc, s) => acc.add(s.qtyAccepted).add(s.qtyReturned).add(s.qtySpoiled),
    new Prisma.Decimal(0)
  );
  const remaining = note.qtySent.sub(settled);

  return (
    <div className="max-w-lg">
      <Link
        href={`/vouchers/deliveries/${note.id}`}
        className="text-muted text-[12px] underline underline-offset-2"
      >
        ← Delivery Note
      </Link>
      <h1 className="heading text-xl font-semibold mt-1 mb-1">
        New Settlement
      </h1>
      <p className="text-muted text-[13px] mb-3">
        {note.party.name} · {CHANNEL_LABELS[note.channel]} ·{" "}
        {fmtDate(note.date)} · {note.fishType} · rate locked at{" "}
        {fmtMoney(note.rate)}/kg
      </p>

      <div className="border border-line-strong bg-surface px-4 py-3 mb-4 flex justify-between items-center">
        <span className="text-[12px] uppercase tracking-wide text-muted font-semibold">
          Party&apos;s outstanding balance before this entry
        </span>
        <span
          className={`num text-lg font-bold ${
            balance.greaterThan(0) ? "text-debit" : "text-credit"
          }`}
        >
          {fmtMoney(balance)}
        </span>
      </div>

      <p className="text-[13px] mb-4">
        <span className="num font-semibold">{fmtKg(remaining)}</span> of{" "}
        <span className="num">{fmtKg(note.qtySent)}</span> still unsettled.
      </p>

      <SettleForm
        action={createSettlement.bind(null, note.id)}
        channel={note.channel}
        remaining={remaining.toString()}
        rate={note.rate.toString()}
      />
    </div>
  );
}
