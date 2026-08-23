import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { canEnter, requireSession } from "@/lib/session";
import { getActiveScope, scopeFieldValues } from "@/lib/centre";
import { createExpense } from "../actions";
import { ExpenseForm } from "../expense-form";
import { NoCentreNotice } from "../../../no-centre";

export default async function NewExpensePage() {
  const session = await requireSession();
  if (!canEnter(session.role)) redirect("/vouchers/expenses");
  const { company, centre } = await getActiveScope();
  if (!centre) return <NoCentreNotice companyName={company.name} />;

  // Categories are data now, so the form is handed the live list rather than
  // importing a constant. Archived ones drop out; ordering is the merchant's.
  // RENT is excluded on purpose. Vehicle rent is expensed exactly once, from
  // the trip, dated to the buying day (spec §2, invariant 2) — the advance and
  // whatever a market party paid the driver are settlements against it, never
  // further expenses. A hand-entered rent voucher would be the second one, and
  // the day would carry the cost twice.
  const categories = await prisma.expenseCategory.findMany({
    where: {
      companyId: company.id,
      archivedAt: null,
      code: { not: "RENT" },
    },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, code: true, name: true, allowsLines: true, kind: true },
  });

  return (
    <div>
      <h1 className="heading text-xl font-semibold mb-1">New Expense</h1>
      <p className="text-muted text-[13px] mb-4">
        Entering for {company.name} · {centre.name}.
      </p>
      <ExpenseForm
        action={createExpense}
        categories={categories}
        submitLabel="Save Expense"
        scope={scopeFieldValues({ company, centre })}
      />
    </div>
  );
}
