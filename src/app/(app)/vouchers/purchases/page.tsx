import Link from "next/link";
import { VoucherRowActions } from "../row-actions";
import { prisma } from "@/lib/db";
import { canEnter, requireSession } from "@/lib/session";
import { getActiveScope } from "@/lib/centre";
import { fmtDate, fmtMoney } from "@/lib/format";
import {
  dateWhere,
  parseListWindow,
  type SearchParams,
} from "@/lib/paging";
import { DateWindow, Pager } from "../../list-controls";
import { NoCentreNotice } from "../../no-centre";

const TYPE_LABELS = {
  SOCIETY: "Society",
  KFDC: "KFDC",
  PRIVATE: "Private",
  LOCAL: "Local",
};

export default async function PurchasesPage({
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

  const [purchases, total] = await Promise.all([
    prisma.purchase.findMany({
      where,
      include: {
        party: { select: { name: true } },
        _count: { select: { lines: true } },
        // The boats behind the bill. On a Society purchase the money is owed to
        // the Society, so "Owed to" alone never tells you WHICH boat the
        // payment is for — which is the thing the merchant actually needs when
        // settling. The names are already on the rows; they were just never
        // brought up to the list.
        lines: { select: { boat: { select: { name: true } } } },
      },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      skip: listWindow.skip,
      take: listWindow.take,
    }),
    prisma.purchase.count({ where }),
  ]);

  return (
    <div>
      <div className="flex items-end justify-between flex-wrap gap-3 mb-4">
        <div>
          <h1 className="heading text-xl font-semibold">Purchases</h1>
          <p className="text-muted text-[13px]">
            {company.name} · each bill posts to the ledger of whoever it is owed
            to; the boats are named on its rows.
          </p>
        </div>
        {mayEnter && (
          <Link
            href="/vouchers/purchases/new"
            className="bg-accent text-white px-4 py-2 text-[13px] font-semibold"
          >
            New Purchase
          </Link>
        )}
      </div>

      <DateWindow basePath="/vouchers/purchases" window={listWindow} />

      {purchases.length === 0 ? (
        <p className="text-[13px] text-muted border border-line bg-surface px-4 py-3 max-w-lg">
          No purchases for {company.name} between {listWindow.from} and{" "}
          {listWindow.to}. Widen the dates above to look further back.
          {mayEnter && " Or use “New Purchase” to enter one."}
        </p>
      ) : (
        <div className="border border-line-strong bg-surface overflow-x-auto">
          <table className="ledger-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>No.</th>
                <th>Owed to</th>
                <th>Type</th>
                <th className="num-col">Items</th>
                <th className="num-col">Total</th>
                <th className="w-16"></th>
              </tr>
            </thead>
            <tbody>
              {purchases.map((p) => {
                // Distinct and in row order: one boat usually lands several
                // varieties on one bill, and repeating its name once per line
                // would be noise rather than information.
                const boats = [
                  ...new Set(
                    p.lines
                      .map((l) => l.boat?.name)
                      .filter((n): n is string => Boolean(n))
                  ),
                ];
                return (
                  <tr key={p.id}>
                    <td className="whitespace-nowrap">
                      {fmtDate(p.date)}
                    </td>
                    <td >
                      {p.billNo ?? <span className="text-muted">—</span>}
                    </td>
                    <td className="font-medium">
                      <span>{p.party.name}</span>
                      {boats.length > 0 && (
                        <div className="text-muted text-[12px] font-normal">
                          {boats.join(", ")}
                        </div>
                      )}
                    </td>
                    <td >{TYPE_LABELS[p.type]}</td>
                    <td className="num-col num text-muted">
                      {p._count.lines || "—"}
                    </td>
                    <td className="num-col num text-debit">
                      {fmtMoney(p.amount)}
                    </td>
                    <td>
                      <VoucherRowActions
                        viewHref={`/vouchers/purchases/${p.id}`}
                        printHref={`/api/vouchers/purchases/${p.id}/pdf`}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {purchases.length > 0 && (
        <Pager
          basePath="/vouchers/purchases"
          window={listWindow}
          total={total}
        />
      )}
    </div>
  );
}
