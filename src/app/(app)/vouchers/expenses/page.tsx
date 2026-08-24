import Link from "next/link";
import { prisma } from "@/lib/db";
import { canEdit, canEnter, requireSession } from "@/lib/session";
import { getActiveScope } from "@/lib/centre";
import { fmtDate, fmtMoney } from "@/lib/format";
import { dateWhere, parseListWindow, type SearchParams } from "@/lib/paging";
import { DateWindow, Pager } from "../../list-controls";
import { NoCentreNotice } from "../../no-centre";

export default async function ExpensesPage({
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

  const [expenses, total] = await Promise.all([
    prisma.expense.findMany({
      where,
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      skip: listWindow.skip,
      take: listWindow.take,
      // One query with the category joined, never one lookup per row.
      include: { category: { select: { name: true } } },
    }),
    prisma.expense.count({ where }),
  ]);

  return (
    <div>
      <div className="flex items-end justify-between flex-wrap gap-3 mb-4">
        <div>
          <h1 className="heading text-xl font-semibold">Expenses</h1>
          <p className="text-muted text-[13px]">
            {company.name} · ice, loaders, ladies, batha, canteen, rent.
          </p>
        </div>
        {mayEnter && (
          <Link
            href="/vouchers/expenses/new"
            className="bg-accent text-white px-4 py-2 text-[13px] font-semibold"
          >
            New Expense
          </Link>
        )}
      </div>

      <DateWindow basePath="/vouchers/expenses" window={listWindow} />

      {expenses.length === 0 ? (
        <p className="text-[13px] text-muted border border-line bg-surface px-4 py-3 max-w-lg">
          No expenses for {company.name} between {listWindow.from} and{" "}
          {listWindow.to}. Widen the dates above to look further back.
          {mayEnter && " Or use “New Expense” to enter one."}
        </p>
      ) : (
        <div className="border border-line-strong bg-surface max-w-2xl overflow-x-auto">
          <table className="ledger-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Category</th>
                <th>Notes</th>
                <th className="num-col">Amount</th>
                <th className="w-16"></th>
              </tr>
            </thead>
            <tbody>
              {expenses.map((e) => {
                return (
                  <tr key={e.id}>
                    <td className="whitespace-nowrap">
                      {fmtDate(e.date)}
                    </td>
                    <td className="font-medium">{e.category.name}</td>
                    <td className="text-muted">{e.notes ?? "—"}</td>
                    <td className="num-col num text-debit">
                      {fmtMoney(e.amount)}
                    </td>
                    <td>
                      <Link
                        href={`/vouchers/expenses/${e.id}`}
                        className="text-accent underline underline-offset-2 text-[12px]"
                      >
                        {mayEdit ? "Edit" : "View"}
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {expenses.length > 0 && (
        <Pager basePath="/vouchers/expenses" window={listWindow} total={total} />
      )}
    </div>
  );
}
