import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { getActiveScope } from "@/lib/centre";
import { sumDeliveryLines } from "@/lib/delivery";
import { fmtDate } from "@/lib/format";
import { NoCentreNotice } from "../../no-centre";

export default async function DeliveriesPage() {
  const session = await requireSession();
  const isMerchant = session.role === "MERCHANT";
  const { company, centre } = await getActiveScope();
  if (!centre) return <NoCentreNotice companyName={company.name} />;

  const notes = await prisma.deliveryNote.findMany({
    where: { companyId: company.id, centreId: centre.id },
    include: { lines: true },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
  });

  return (
    <div>
      <div className="flex items-end justify-between mb-4">
        <div>
          <h1 className="heading text-xl font-semibold">Delivery Notes</h1>
          <p className="text-muted text-[13px]">
            {company.name} · {centre.name} · dispatch records only — no
            settlement or ledger.
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
          No delivery notes for {company.name} · {centre.name} yet.
          {isMerchant && " Use “New Delivery Note” to record a dispatch."}
        </p>
      ) : (
        <div className="border border-line-strong bg-surface">
          <table className="ledger-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Bill No.</th>
                <th>To</th>
                <th>Vehicle</th>
                <th className="num-col">Box</th>
                <th className="num-col">Big Box</th>
                <th className="num-col">Loose</th>
                <th className="num-col">Pcs</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {notes.map((n) => {
                const t = sumDeliveryLines(n.lines);
                return (
                  <tr key={n.id}>
                    <td className="whitespace-nowrap">{fmtDate(n.date)}</td>
                    <td className="num">{n.billNo}</td>
                    <td className="font-medium">{n.recipient}</td>
                    <td className="num">{n.vehicleNo}</td>
                    <td className="num-col num">{t.box || "—"}</td>
                    <td className="num-col num">{t.bigBox || "—"}</td>
                    <td className="num-col num">{t.loose || "—"}</td>
                    <td className="num-col num">{t.pcs || "—"}</td>
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
