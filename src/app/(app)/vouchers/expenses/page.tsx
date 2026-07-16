import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { getActiveCompany } from "@/lib/company";
import { EXPENSE_CATEGORY_LABELS } from "@/lib/expense";
import { fmtDate, fmtMoney } from "@/lib/format";

export default async function ExpensesPage() {
  const session = await requireSession();
  const isMerchant = session.role === "MERCHANT";
  const company = await getActiveCompany();

  const expenses = await prisma.expense.findMany({
    where: { companyId: company.id },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
  });

  return (
    <div>
      <div className="flex items-end justify-between mb-4">
        <div>
          <h1 className="heading text-xl font-semibold">Expenses</h1>
          <p className="text-muted text-[13px]">
            {company.name} · loaders, workers, ice, canteen, rent, transport,
            fuel, misc.
          </p>
        </div>
        {isMerchant && (
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
          {isMerchant && " Use “New Expense” to enter the first one."}
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
                {isMerchant && <th className="w-16"></th>}
              </tr>
            </thead>
            <tbody>
              {expenses.map((e) => (
                <tr key={e.id}>
                  <td className="whitespace-nowrap">{fmtDate(e.date)}</td>
                  <td className="font-medium">
                    {EXPENSE_CATEGORY_LABELS[e.category]}
                  </td>
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
