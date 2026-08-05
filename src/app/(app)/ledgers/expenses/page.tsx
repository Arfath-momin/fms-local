import Link from "next/link";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { getActiveScope } from "@/lib/centre";
import { EXPENSE_CATEGORIES, EXPENSE_CATEGORY_LABELS } from "@/lib/expense";
import { getFlaggedIds } from "@/lib/errorflag";
import { sectionLedgers } from "@/lib/ledger-index";
import { EXPENSE_LEDGER_TYPES } from "@/lib/party";
import { fmtMoney } from "@/lib/format";
import { LedgerTable } from "../ledger-list";
import { NoCentreNotice } from "../../no-centre";

// Two views of the same spend, because the merchant asks two questions of it:
// "what did ice cost this month" (category) and "what do I still owe the ice
// plant" (vendor). Categories are the spec's mini ledgers; the vendor ledgers
// are ordinary party statements that payments settle against.
export default async function ExpenseLedgersPage() {
  await requireSession();
  const { company, centre } = await getActiveScope();
  if (!centre) return <NoCentreNotice companyName={company.name} />;

  const [groups, vendors] = await Promise.all([
    prisma.expense.groupBy({
      by: ["category"],
      where: {
        companyId: company.id,
        centreId: centre.id,
        id: { notIn: await getFlaggedIds("EXPENSE") },
      },
      _sum: { amount: true },
      _count: true,
    }),
    sectionLedgers(
      { companyId: company.id, centreId: centre.id },
      EXPENSE_LEDGER_TYPES
    ),
  ]);
  const byCategory = new Map(groups.map((g) => [g.category, g]));

  const total = groups.reduce(
    (acc, g) => acc.add(g._sum.amount ?? 0),
    new Prisma.Decimal(0)
  );

  return (
    <div className="max-w-2xl">
      <Link
        href="/ledgers"
        className="text-muted text-[12px] underline underline-offset-2"
      >
        ← Ledgers
      </Link>
      <div className="flex items-end justify-between mt-1 mb-4">
        <div>
          <h1 className="heading text-xl font-semibold">Expense Ledgers</h1>
          <p className="text-muted text-[13px]">
            {company.name} · {centre.name} · by category, then by vendor.
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

      <h2 className="heading text-[15px] font-semibold mb-1">By category</h2>
      <p className="text-muted text-[12px] mb-2">
        What was spent under each head — ice, loaders, ladies, batha, canteen,
        rent.
      </p>
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

      <h2 className="heading text-[15px] font-semibold mt-6 mb-1">By vendor</h2>
      <p className="text-muted text-[12px] mb-2">
        A running statement per vendor — negative means we still owe them.
        Payment vouchers settle against these.
      </p>
      <LedgerTable
        rows={vendors}
        empty={`No expense vendors have a ledger in ${centre.name} yet.`}
      />
    </div>
  );
}
