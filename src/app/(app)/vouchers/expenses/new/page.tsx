import { redirect } from "next/navigation";
import { canEnter, requireSession } from "@/lib/session";
import { getActiveScope } from "@/lib/centre";
import { createExpense } from "../actions";
import { ExpenseForm } from "../expense-form";
import { NoCentreNotice } from "../../../no-centre";

export default async function NewExpensePage() {
  const session = await requireSession();
  if (!canEnter(session.role)) redirect("/vouchers/expenses");
  const { company, centre } = await getActiveScope();
  if (!centre) return <NoCentreNotice companyName={company.name} />;

  return (
    <div>
      <h1 className="heading text-xl font-semibold mb-1">New Expense</h1>
      <p className="text-muted text-[13px] mb-4">
        Entering for {company.name} · {centre.name}.
      </p>
      <ExpenseForm action={createExpense} submitLabel="Save Expense" />
    </div>
  );
}
