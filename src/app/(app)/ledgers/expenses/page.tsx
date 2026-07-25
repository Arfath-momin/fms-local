import Link from "next/link";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { getActiveScope } from "@/lib/centre";
import { EXPENSE_CATEGORIES, EXPENSE_CATEGORY_LABELS } from "@/lib/expense";
import { getFlaggedIds } from "@/lib/errorflag";
import { fmtMoney } from "@/lib/format";
import { NoCentreNotice } from "../../no-centre";

// Each category is its own mini ledger (spec §2 Expense), scoped to the centre.
export default async function ExpenseLedgersPage() {
  await requireSession();
  const { company, centre } = await getActiveScope();
  if (!centre) return <NoCentreNotice companyName={company.name} />;

  const groups = await prisma.expense.groupBy({
    by: ["category"],
    where: {
      companyId: company.id,
      centreId: centre.id,
      id: { notIn: await getFlaggedIds("EXPENSE") },
    },
    _sum: { amount: true },
    _count: true,
  });
  const byCategory = new Map(groups.map((g) => [g.category, g]));

  const total = groups.reduce(
    (acc, g) => acc.add(g._sum.amount ?? 0),
    new Prisma.Decimal(0)
  );

  return (
    <div className="max-w-2xl">
      <div className="flex items-end justify-between mb-4">
        <div>
          <h1 className="heading text-xl font-semibold">Expense Ledgers</h1>
          <p className="text-muted text-[13px]">
            {company.name} · {centre.name} · one mini ledger per category.
          </p>
        </div>
        <div className="text-right">
          <div className="text-[12px] uppercase tracking-wide text-muted font-semibold">
            Total Expenses
          </div>
          <div className="num text-xl font-bold text-debit">
            {fmtMoney(total)}
          </div>
        </div>
      </div>

      <div className="border border-line-strong bg-surface">
        <table className="ledger-table">
          <thead>
            <tr>
              <th>Category</th>
              <th className="num-col">Entries</th>
              <th className="num-col">Total</th>
            </tr>
          </thead>
          <tbody>
            {EXPENSE_CATEGORIES.map((cat) => {
              const g = byCategory.get(cat);
              return (
                <tr key={cat}>
                  <td className="font-medium">
                    <Link
                      href={`/ledgers/expenses/${cat.toLowerCase()}`}
                      className="text-accent underline underline-offset-2"
                    >
                      {EXPENSE_CATEGORY_LABELS[cat]}
                    </Link>
                  </td>
                  <td className="num-col num">{g?._count ?? 0}</td>
                  <td className="num-col num text-debit">
                    {fmtMoney(g?._sum.amount ?? 0)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
