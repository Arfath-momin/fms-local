import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { toInputDate } from "@/lib/format";
import { updateExpense } from "../actions";
import { ExpenseForm } from "../expense-form";

export default async function EditExpensePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireSession();
  if (session.role !== "MERCHANT") redirect("/vouchers/expenses");

  const { id } = await params;
  const expense = await prisma.expense.findUnique({ where: { id } });
  if (!expense) notFound();

  const dayClose = await prisma.dayClose.findUnique({
    where: {
      companyId_date: { companyId: expense.companyId, date: expense.date },
    },
  });

  if (dayClose) {
    return (
      <div>
        <h1 className="heading text-xl font-semibold mb-4">Edit Expense</h1>
        <p className="text-[13px] border border-line bg-surface px-4 py-3 max-w-lg">
          This expense belongs to a closed day and can no longer be edited
          directly. Corrections to closed days go through the error-flag flow.
        </p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="heading text-xl font-semibold mb-4">Edit Expense</h1>
      <ExpenseForm
        action={updateExpense.bind(null, expense.id)}
        initial={{
          category: expense.category,
          amount: expense.amount.toString(),
          date: toInputDate(expense.date),
          notes: expense.notes,
        }}
        submitLabel="Save Changes"
      />
    </div>
  );
}
