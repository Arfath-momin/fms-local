import Link from "next/link";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { getActiveCompany } from "@/lib/company";
import { CHANNEL_LABELS, PENDING_WARN_DAYS } from "@/lib/delivery";
import { getClosedDateSet } from "@/lib/dayclose";
import { fmtDate, fmtMoney, toInputDate } from "@/lib/format";
import { StatusBadge, daysSince } from "./status-badge";
import { LockMark } from "../../lock-mark";

export default async function DeliveriesPage() {
  const session = await requireSession();
  const isMerchant = session.role === "MERCHANT";
  const company = await getActiveCompany();

  const [notes, closedDates] = await Promise.all([
    prisma.deliveryNote.findMany({
      where: { companyId: company.id },
      include: {
        party: { select: { name: true } },
        settlements: { select: { amount: true } },
      },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    }),
    getClosedDateSet(company.id),
  ]);

  return (
    <div>
      <div className="flex items-end justify-between mb-4">
        <div>
          <h1 className="heading text-xl font-semibold">Delivery Notes</h1>
          <p className="text-muted text-[13px]">
            {company.name} · dispatch on a vehicle, then settle with the bill.
          </p>
        </div>
        {isMerchant && (
          <Link
            href="/vouchers/deliveries/new"
            className="bg-accent text-white px-4 py-2 text-[13px] font-semibold"
          >
            New Delivery Note
          </Link>
        )}
      </div>

      {notes.length === 0 ? (
        <p className="text-[13px] text-muted border border-line bg-surface px-4 py-3 max-w-lg">
          No delivery notes for {company.name} yet.
          {isMerchant && " Use “New Delivery Note” to dispatch."}
        </p>
      ) : (
        <div className="border border-line-strong bg-surface">
          <table className="ledger-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Vehicle</th>
                <th>Type</th>
                <th>Buyer</th>
                <th className="num-col">Bill Amount</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {notes.map((n) => {
                const age = daysSince(n.date);
                const overdue = n.status !== "SETTLED" && age >= PENDING_WARN_DAYS;
                const billed = n.settlements.reduce(
                  (acc, s) => acc.add(s.amount),
                  new Prisma.Decimal(0)
                );
                return (
                  <tr key={n.id}>
                    <td className="whitespace-nowrap">
                      {fmtDate(n.date)}
                      <LockMark closed={closedDates.has(toInputDate(n.date))} />
                    </td>
                    <td className="num">{n.vehicleNo}</td>
                    <td>{CHANNEL_LABELS[n.channel]}</td>
                    <td className="font-medium">{n.party.name}</td>
                    <td className="num-col num text-credit">
                      {n.settlements.length > 0 ? fmtMoney(billed) : "—"}
                    </td>
                    <td className="whitespace-nowrap">
                      <StatusBadge status={n.status} />
                      {overdue && (
                        <span className="ml-2 text-debit text-[11px] font-semibold">
                          {age} days unsettled
                        </span>
                      )}
                    </td>
                    <td>
                      <Link
                        href={`/vouchers/deliveries/${n.id}`}
                        className="text-accent underline underline-offset-2 text-[12px]"
                      >
                        Open
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
