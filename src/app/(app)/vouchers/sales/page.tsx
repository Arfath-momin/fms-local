import Link from "next/link";
import { VoucherRowActions } from "../row-actions";
import { prisma } from "@/lib/db";
import { canEnter, requireSession } from "@/lib/session";
import { getActiveScope } from "@/lib/centre";
import { SALE_TYPE_LABELS } from "@/lib/sale";
import { fmtDate, fmtMoney } from "@/lib/format";
import { dateWhere, parseListWindow, type SearchParams } from "@/lib/paging";
import { DateWindow, Pager } from "../../list-controls";
import { NoCentreNotice } from "../../no-centre";

export default async function SalesPage({
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

  const [sales, total] = await Promise.all([
    prisma.sale.findMany({
      where,
      include: {
        party: { select: { name: true } },
        careOfParty: { select: { name: true } },
      },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      skip: listWindow.skip,
      take: listWindow.take,
    }),
    prisma.sale.count({ where }),
  ]);

  return (
    <div>
      <div className="flex items-end justify-between flex-wrap gap-3 mb-4">
        <div>
          <h1 className="heading text-xl font-semibold">Sales</h1>
          <p className="text-muted text-[13px]">
            {company.name} · {centre.name} · each sale posts to the buyer (or
            CareOf) ledger.
          </p>
        </div>
        {mayEnter && (
          <Link
            href="/vouchers/sales/new"
            className="bg-accent text-white px-4 py-2 text-[13px] font-semibold"
          >
            New Sale
          </Link>
        )}
      </div>

      <DateWindow basePath="/vouchers/sales" window={listWindow} />

      {sales.length === 0 ? (
        <p className="text-[13px] text-muted border border-line bg-surface px-4 py-3 max-w-lg">
          No sales for {company.name} · {centre.name} between {listWindow.from}{" "}
          and {listWindow.to}. Widen the dates above to look further back.
          {mayEnter && " Or use “New Sale” to record one."}
        </p>
      ) : (
        <div className="border border-line-strong bg-surface overflow-x-auto">
          <table className="ledger-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Bill No.</th>
                <th>Type</th>
                <th>Party</th>
                <th>Vehicle No.</th>
                <th className="num-col">Amount</th>
                <th className="w-16"></th>
              </tr>
            </thead>
            <tbody>
              {sales.map((s) => {
                return (
                  <tr key={s.id}>
                    <td className="whitespace-nowrap">
                      {fmtDate(s.date)}
                    </td>
                    <td className="num">{s.billNo}</td>
                    <td >{SALE_TYPE_LABELS[s.type]}</td>
                    <td className="font-medium">
                      <span>{s.party.name}</span>
                      {s.careOfParty && (
                        <span className="text-muted text-[12px]">
                          {" "}· c/o {s.careOfParty.name}
                        </span>
                      )}
                    </td>
                    <td className="num">
                      {s.vehicleNo ?? <span className="text-muted">—</span>}
                    </td>
                    <td className="num-col num text-credit">
                      {fmtMoney(s.amount)}
                    </td>
                    <td>
                      <VoucherRowActions
                        viewHref={`/vouchers/sales/${s.id}`}
                        printHref={`/api/vouchers/sales/${s.id}/pdf`}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {sales.length > 0 && (
        <Pager basePath="/vouchers/sales" window={listWindow} total={total} />
      )}
    </div>
  );
}
