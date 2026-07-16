import { redirect } from "next/navigation";
import { requireSession } from "@/lib/session";
import { getActiveCompany } from "@/lib/company";
import { createExpense } from "../actions";
import { ExpenseForm } from "../expense-form";

export default async function NewExpensePage() {
  const session = await requireSession();
  if (session.role !== "MERCHANT") redirect("/vouchers/expenses");
  const company = await getActiveCompany();

  return (
    <div>
      <h1 className="heading text-xl font-semibold mb-1">New Expense</h1>
      <p className="text-muted text-[13px] mb-4">Entering for {company.name}.</p>
      <ExpenseForm action={createExpense} submitLabel="Save Expense" />
    </div>
  );
}
