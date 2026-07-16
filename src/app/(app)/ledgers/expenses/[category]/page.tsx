import Link from "next/link";
import { notFound } from "next/navigation";
import { Prisma } from "@/generated/prisma/client";
import type { ExpenseCategory } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { getActiveCompany } from "@/lib/company";
import { EXPENSE_CATEGORIES, EXPENSE_CATEGORY_LABELS } from "@/lib/expense";
import { fmtDate, fmtMoney } from "@/lib/format";

export default async function ExpenseCategoryPage({
  params,
}: {
  params: Promise<{ category: string }>;
}) {
  const session = await requireSession();
  const isMerchant = session.role === "MERCHANT";
  const company = await getActiveCompany();

  const category = (await params).category.toUpperCase() as ExpenseCategory;
  if (!EXPENSE_CATEGORIES.includes(category)) notFound();

  const expenses = await prisma.expense.findMany({
    where: { companyId: company.id, category },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
  });
  const total = expenses.reduce(
    (acc, e) => acc.add(e.amount),
    new Prisma.Decimal(0)
  );

  return (
    <div className="max-w-2xl">
      <Link
        href="/ledgers/expenses"
        className="text-muted text-[12px] underline underline-offset-2"
      >
        ← Expense Ledgers
      </Link>
      <div className="flex items-end justify-between mt-1 mb-4">
        <h1 className="heading text-xl font-semibold">
          {EXPENSE_CATEGORY_LABELS[category]} — {company.name}
        </h1>
        <div className="text-right">
          <div className="text-[12px] uppercase tracking-wide text-muted font-semibold">
            Category Total
          </div>
          <div className="num text-xl font-bold text-debit">
            {fmtMoney(total)}
          </div>
        </div>
      </div>

      {expenses.length === 0 ? (
        <p className="text-[13px] text-muted border border-line bg-surface px-4 py-3 max-w-lg">
          No {EXPENSE_CATEGORY_LABELS[category].toLowerCase()} expenses for{" "}
          {company.name} yet.
        </p>
      ) : (
        <div className="border border-line-strong bg-surface">
          <table className="ledger-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Notes</th>
                <th className="num-col">Amount</th>
                {isMerchant && <th className="w-16"></th>}
              </tr>
            </thead>
            <tbody>
              {expenses.map((e) => (
                <tr key={e.id}>
                  <td className="whitespace-nowrap">{fmtDate(e.date)}</td>
                  <td className="text-muted">{e.notes ?? "—"}</td>
                  <td className="num-col num text-debit">
                    {fmtMoney(e.amount)}
                  </td>
                  {isMerchant && (
                    <td>
                      <Link
                        href={`/vouchers/expenses/${e.id}`}
                        className="text-accent underline underline-offset-2 text-[12px]"
                      >
                        Edit
                      </Link>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
