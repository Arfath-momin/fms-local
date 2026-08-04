import Link from "next/link";
import { prisma } from "@/lib/db";
import { canEdit, canEnter, requireSession } from "@/lib/session";
import { getActiveScope } from "@/lib/centre";
import { getFlagsFor } from "@/lib/errorflag";
import { SALE_TYPE_LABELS } from "@/lib/sale";
import { fmtDate, fmtMoney } from "@/lib/format";
import { dateWhere, parseListWindow, type SearchParams } from "@/lib/paging";
import { CorrectedBadge } from "../../lock-mark";
import { DateWindow, Pager } from "../../list-controls";
import { NoCentreNotice } from "../../no-centre";

export default async function SalesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await requireSession();
  const mayEnter = canEnter(session.role);
  const mayEdit = canEdit(session.role);
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
  const flags = await getFlagsFor("SALE", sales.map((s) => s.id));

  return (
    <div>
      <div className="flex items-end justify-between mb-4">
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
        <div className="border border-line-strong bg-surface">
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
                const flag = flags.get(s.id);
                const struck = flag ? "line-through opacity-60" : "";
                return (
                  <tr key={s.id}>
                    <td className="whitespace-nowrap">
                      {fmtDate(s.date)}
                    </td>
                    <td className={`num ${struck}`}>{s.billNo}</td>
                    <td className={struck}>{SALE_TYPE_LABELS[s.type]}</td>
                    <td className="font-medium">
                      <span className={struck}>{s.party.name}</span>
                      {s.careOfParty && (
                        <span className="text-muted text-[12px]">
                          {" "}· c/o {s.careOfParty.name}
                        </span>
                      )}
                      {flag && (
                        <CorrectedBadge
                          href={
                            flag.correctingEntryId
                              ? `/vouchers/sales/${flag.correctingEntryId}`
                              : null
                          }
                        />
                      )}
                    </td>
                    <td className={`num ${struck}`}>
                      {s.vehicleNo ?? <span className="text-muted">—</span>}
                    </td>
                    <td className={`num-col num text-credit ${struck}`}>
                      {fmtMoney(s.amount)}
                    </td>
                    <td>
                      <Link
                        href={`/vouchers/sales/${s.id}`}
                        className="text-accent underline underline-offset-2 text-[12px]"
                      >
                        {mayEdit && !flag ? "Edit" : "View"}
                      </Link>
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
