import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { getActiveCompany } from "@/lib/company";
import { CHANNEL_LABELS, PENDING_WARN_DAYS } from "@/lib/delivery";
import { getClosedDateSet } from "@/lib/dayclose";
import { fmtDate, fmtKg, fmtMoney, toInputDate } from "@/lib/format";
import { StatusBadge, daysSince } from "./status-badge";
import { LockMark } from "../../lock-mark";

export default async function DeliveriesPage() {
  const session = await requireSession();
  const isMerchant = session.role === "MERCHANT";
  const company = await getActiveCompany();

  const [notes, closedDates] = await Promise.all([
    prisma.deliveryNote.findMany({
      where: { companyId: company.id },
      include: { party: { select: { name: true } } },
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
            {company.name} · dispatched stock stays In Transit until settled.
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
          {isMerchant && " Use “New Delivery Note” to dispatch stock."}
        </p>
      ) : (
        <div className="border border-line-strong bg-surface">
          <table className="ledger-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Buyer</th>
                <th>Channel</th>
                <th>Fish</th>
                <th className="num-col">Qty Sent</th>
                <th className="num-col">Rate</th>
                <th className="num-col">Expected</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {notes.map((n) => {
                const age = daysSince(n.date);
                const overdue =
                  n.status !== "SETTLED" && age >= PENDING_WARN_DAYS;
                return (
                  <tr key={n.id}>
                    <td className="whitespace-nowrap">
                      {fmtDate(n.date)}
                      <LockMark closed={closedDates.has(toInputDate(n.date))} />
                    </td>
                    <td className="font-medium">{n.party.name}</td>
                    <td>{CHANNEL_LABELS[n.channel]}</td>
                    <td>{n.fishType}</td>
                    <td className="num-col num">{fmtKg(n.qtySent)}</td>
                    <td className="num-col num">{fmtMoney(n.rate)}</td>
                    <td className="num-col num">{fmtMoney(n.expectedValue)}</td>
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
