import Link from "next/link";
import { notFound } from "next/navigation";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { canEdit, requireSession } from "@/lib/session";
import { getActiveScope } from "@/lib/centre";
import { fmtDate, fmtMoney } from "@/lib/format";
import { NoCentreNotice } from "../../../no-centre";

export default async function ExpenseCategoryPage({
  params,
}: {
  params: Promise<{ category: string }>;
}) {
  const session = await requireSession();
  const mayEdit = canEdit(session.role);
  const { company, centre } = await getActiveScope();
  if (!centre) return <NoCentreNotice companyName={company.name} />;

  // The URL still carries the category CODE, not its id — a link that survives
  // the category being renamed, and one a person can read.
  const code = (await params).category.toUpperCase();
  const category = await prisma.expenseCategory.findUnique({
    where: { companyId_code: { companyId: company.id, code } },
    select: { id: true, name: true, kind: true },
  });
  if (!category) notFound();

  const expenses = await prisma.expense.findMany({
    where: {
      companyId: company.id,
      centreId: centre.id,
      categoryId: category.id,
    },
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
          {category.name} — {company.name}
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
          No {category.name.toLowerCase()} expenses for{" "}
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
                <th className="w-16"></th>
              </tr>
            </thead>
            <tbody>
              {expenses.map((e) => {
                return (
                <tr key={e.id}>
                  <td className="whitespace-nowrap">{fmtDate(e.date)}</td>
                  <td className={`text-muted`}>{e.notes ?? "—"}</td>
                  <td className={`num-col num text-debit`}>
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
    </div>
  );
}
