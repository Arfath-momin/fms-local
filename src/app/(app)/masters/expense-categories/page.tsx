import Link from "next/link";
import { prisma } from "@/lib/db";
import { canAdminister, canSuperAdminister, requireSession } from "@/lib/session";
import { getActiveCompany } from "@/lib/company";
import { EXPENSE_SPECS } from "@/lib/expense";
import { CategoryActionsCell, CategoryCreateForm } from "./category-forms";

/**
 * The expense category master.
 *
 * Categories were an enum, so adding "Electricity" meant a migration and a
 * deploy — and there was nowhere to record the thing that actually matters
 * about a cost: whether it belongs to a buying day or to the month.
 */
export default async function ExpenseCategoriesPage() {
  const session = await requireSession();
  const mayManage = canAdminister(session.role);
  const isSuperAdmin = canSuperAdminister(session.role);
  const company = await getActiveCompany();

  const categories = await prisma.expenseCategory.findMany({
    where: { companyId: company.id },
    orderBy: [
      { archivedAt: { sort: "asc", nulls: "first" } },
      { kind: "asc" },
      { sortOrder: "asc" },
    ],
    include: { _count: { select: { expenses: true } } },
  });

  const direct = categories.filter((c) => c.kind === "DIRECT");
  const overhead = categories.filter((c) => c.kind === "OVERHEAD");

  return (
    <div className="max-w-3xl">
      <Link
        href="/masters"
        className="text-muted text-[12px] underline underline-offset-2"
      >
        ← Masters
      </Link>
      <h1 className="heading text-xl font-semibold mt-1 mb-1">
        Expense Categories
      </h1>
      <p className="text-muted text-[13px] mb-4">
        {company.name} · which tier a cost lands in.{" "}
        <span className="font-semibold text-foreground">Direct</span> costs
        belong to the buying day and set its gross profit;{" "}
        <span className="font-semibold text-foreground">overheads</span> belong
        to the month and touch the net figure only.
      </p>

      <Section
        title="Direct — cost of the catch"
        blurb="Ice, loaders, ladies, batha, canteen and vehicle rent. These reduce a buying day's gross profit."
        rows={direct}
        mayManage={mayManage}
        isSuperAdmin={isSuperAdmin}
      />

      <Section
        title="Overhead — cost of the month"
        blurb="Salaries, office rent, electricity. A salary is not a cost of Tuesday's catch, so these never touch a daily figure."
        rows={overhead}
        mayManage={mayManage}
        isSuperAdmin={isSuperAdmin}
      />

      {mayManage && (
        <div className="border border-line bg-surface px-4 py-3 mt-4">
          <h2 className="heading text-[15px] font-semibold mb-2">
            Add a category
          </h2>
          <CategoryCreateForm />
        </div>
      )}
    </div>
  );
}

function Section({
  title,
  blurb,
  rows,
  mayManage,
  isSuperAdmin,
}: {
  title: string;
  blurb: string;
  rows: {
    id: string;
    code: string;
    name: string;
    allowsLines: boolean;
    archivedAt: Date | null;
    _count: { expenses: number };
  }[];
  mayManage: boolean;
  isSuperAdmin: boolean;
}) {
  return (
    <>
      <h2 className="heading text-[15px] font-semibold mb-1">{title}</h2>
      <p className="text-muted text-[12px] mb-2">{blurb}</p>
      {rows.length === 0 ? (
        <p className="text-muted text-[13px] border border-line bg-surface px-4 py-3 mb-4">
          None yet.
        </p>
      ) : (
        <div className="border border-line-strong bg-surface mb-5">
          <table className="ledger-table">
            <thead>
              <tr>
                <th>Category</th>
                <th>Entry</th>
                <th className="num-col">Entries</th>
                {mayManage && <th className="w-32"></th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className={c.archivedAt ? "opacity-50" : ""}>
                  <td className="font-medium">
                    {c.name}
                    <span className="text-muted text-[12px] num"> · {c.code}</span>
                    {c.archivedAt && (
                      <span className="text-muted text-[12px]"> · archived</span>
                    )}
                  </td>
                  <td className="text-muted text-[12px]">
                    {/* A category with a bespoke shape in lib/expense — ice is
                        blocks × rate, loaders is boxes × rate. Anything the
                        merchant adds gets a plain amount field, which is what
                        lets a new one work without a deploy. */}
                    {c.allowsLines
                      ? "Itemised list"
                      : EXPENSE_SPECS[c.code]
                        ? "Built-in fields"
                        : "Single amount"}
                  </td>
                  <td className="num-col num">{c._count.expenses}</td>
                  {mayManage && (
                    <td>
                      <CategoryActionsCell
                        categoryId={c.id}
                        name={c.name}
                        code={c.code}
                        archived={c.archivedAt !== null}
                        expenses={c._count.expenses}
                        isSuperAdmin={isSuperAdmin}
                      />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
