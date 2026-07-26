import Link from "next/link";
import { prisma } from "@/lib/db";
import { canEdit, canEnter, requireSession } from "@/lib/session";
import { getActiveScope } from "@/lib/centre";
import { EXPENSE_CATEGORY_LABELS } from "@/lib/expense";
import { getFlagsFor } from "@/lib/errorflag";
import { fmtDate, fmtMoney } from "@/lib/format";
import { CorrectedBadge } from "../../lock-mark";
import { NoCentreNotice } from "../../no-centre";

export default async function ExpensesPage() {
  const session = await requireSession();
  const mayEnter = canEnter(session.role);
  const mayEdit = canEdit(session.role);
  const { company, centre } = await getActiveScope();
  if (!centre) return <NoCentreNotice companyName={company.name} />;

  const [expenses] = await Promise.all([
    prisma.expense.findMany({
      where: { companyId: company.id, centreId: centre.id },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    }),
  ]);
  const flags = await getFlagsFor(
    "EXPENSE",
    expenses.map((e) => e.id)
  );

  return (
    <div>
      <div className="flex items-end justify-between mb-4">
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

      {expenses.length === 0 ? (
        <p className="text-[13px] text-muted border border-line bg-surface px-4 py-3 max-w-lg">
          No expenses for {company.name} yet.
          {mayEnter && " Use “New Expense” to enter the first one."}
        </p>
      ) : (
        <div className="border border-line-strong bg-surface max-w-2xl">
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
                const flag = flags.get(e.id);
                const struck = flag ? "line-through opacity-60" : "";
                return (
                  <tr key={e.id}>
                    <td className="whitespace-nowrap">
                      {fmtDate(e.date)}
                    </td>
                    <td className="font-medium">
                      <span className={struck}>
                        {EXPENSE_CATEGORY_LABELS[e.category]}
                      </span>
                      {flag && (
                        <CorrectedBadge
                          href={
                            flag.correctingEntryId
                              ? `/vouchers/expenses/${flag.correctingEntryId}`
                              : null
                          }
                        />
                      )}
                    </td>
                    <td className={`text-muted ${struck}`}>{e.notes ?? "—"}</td>
                    <td className={`num-col num text-debit ${struck}`}>
                      {fmtMoney(e.amount)}
                    </td>
                    <td>
                      <Link
                        href={`/vouchers/expenses/${e.id}`}
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
    </div>
  );
}
