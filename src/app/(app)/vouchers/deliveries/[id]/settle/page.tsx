import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { CHANNEL_LABELS } from "@/lib/delivery";
import { fmtDate, fmtMoney } from "@/lib/format";
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
    include: { party: true },
  });
  if (!note) notFound();
  if (note.status === "SETTLED") redirect(`/vouchers/deliveries/${id}`);

  const lastEntry = await prisma.ledgerEntry.findFirst({
    where: { companyId: note.companyId, partyId: note.partyId },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    select: { runningBalance: true },
  });
  const balance = lastEntry?.runningBalance ?? new Prisma.Decimal(0);

  return (
    <div className="max-w-lg">
      <Link
        href={`/vouchers/deliveries/${note.id}`}
        className="text-muted text-[12px] underline underline-offset-2"
      >
        ← Delivery Note
      </Link>
      <h1 className="heading text-xl font-semibold mt-1 mb-1">Settlement</h1>
      <p className="text-muted text-[13px] mb-3">
        {note.party.name} · {CHANNEL_LABELS[note.channel]} · {fmtDate(note.date)}{" "}
        · Vehicle <span className="num">{note.vehicleNo}</span>
      </p>

      <div className="border border-line-strong bg-surface px-4 py-3 mb-4 flex justify-between items-center">
        <span className="text-[12px] uppercase tracking-wide text-muted font-semibold">
          Buyer&apos;s outstanding balance before this bill
        </span>
        <span
          className={`num text-lg font-bold ${
            balance.greaterThan(0) ? "text-debit" : "text-credit"
          }`}
        >
          {fmtMoney(balance)}
        </span>
      </div>

      <SettleForm action={createSettlement.bind(null, note.id)} />
    </div>
  );
}
