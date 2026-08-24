import Link from "next/link";
import { prisma } from "@/lib/db";
import { canEnter, requireSession } from "@/lib/session";
import { getActiveScope } from "@/lib/centre";
import { sumDeliveryLines } from "@/lib/delivery";
import { fmtDate, fmtMoney } from "@/lib/format";
import { dateWhere, parseListWindow, type SearchParams } from "@/lib/paging";
import { DateWindow, Pager } from "../../list-controls";
import { NoCentreNotice } from "../../no-centre";

export default async function DeliveriesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await requireSession();
  const mayEnter = canEnter(session.role);
  const { company, centre } = await getActiveScope();
  if (!centre) return <NoCentreNotice companyName={company.name} />;

  const listWindow = parseListWindow(await searchParams);
  const where = {
    companyId: company.id,
    centreId: centre.id,
    ...dateWhere(listWindow),
  };

  const [notes, total] = await Promise.all([
    prisma.deliveryNote.findMany({
      where,
      include: { lines: true, vehicle: { select: { number: true, transporter: { select: { name: true } } } } },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      skip: listWindow.skip,
      take: listWindow.take,
    }),
    prisma.deliveryNote.count({ where }),
  ]);

  return (
    <div>
      <div className="flex items-end justify-between flex-wrap gap-3 mb-4">
        <div>
          <h1 className="heading text-xl font-semibold">Delivery Notes</h1>
          <p className="text-muted text-[13px]">
            {company.name} · {centre.name} · dispatch records only — no
            settlement or ledger.
          </p>
        </div>
        {mayEnter && (
          <Link
            href="/vouchers/deliveries/new"
            className="bg-accent text-white px-4 py-2 text-[13px] font-semibold"
          >
            New Delivery Note
          </Link>
        )}
      </div>

      <DateWindow basePath="/vouchers/deliveries" window={listWindow} />

      {notes.length === 0 ? (
        <p className="text-[13px] text-muted border border-line bg-surface px-4 py-3 max-w-lg">
          No delivery notes for {company.name} · {centre.name} between{" "}
          {listWindow.from} and {listWindow.to}. Widen the dates above to look
          further back.
          {mayEnter && " Or use “New Delivery Note” to record a dispatch."}
        </p>
      ) : (
        <div className="border border-line-strong bg-surface overflow-x-auto">
          <table className="ledger-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Bill No.</th>
                <th>To</th>
                <th>Vehicle</th>
                <th className="num-col">Box</th>
                <th className="num-col">Total Kg</th>
                <th className="num-col">Big Box</th>
                <th className="num-col">Loose</th>
                <th className="num-col">Pcs</th>
                <th className="num-col">Advance</th>
                <th className="num-col">Rent</th>
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
                    <td className="num">{n.vehicle.number}</td>
                    <td className="num-col num">{t.box || "—"}</td>
                    <td className="num-col num">
                      {t.totalKg.isZero() ? "—" : t.totalKg.toString()}
                    </td>
                    <td className="num-col num">{t.bigBox || "—"}</td>
                    <td className="num-col num">{t.loose || "—"}</td>
                    {/* The advance handed to the driver at departure, and the
                        trip's total rent once a bill has reported it. Without
                        these on the list, an advance could only be found by
                        opening each note in turn. */}
                    <td className="num-col num">
                      {n.advancePaid ? fmtMoney(n.advancePaid) : "—"}
                    </td>
                    <td className="num-col num">
                      {n.rentAmount ? (
                        fmtMoney(n.rentAmount)
                      ) : (
                        <span className="text-muted text-[12px]">pending</span>
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

      {notes.length > 0 && (
        <Pager
          basePath="/vouchers/deliveries"
          window={listWindow}
          total={total}
        />
      )}
    </div>
  );
}
