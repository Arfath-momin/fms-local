import { redirect } from "next/navigation";
import { canEnter, requireSession } from "@/lib/session";
import { getActiveScope, scopeFieldValues } from "@/lib/centre";
import { createExpense } from "../actions";
import { ExpenseForm } from "../expense-form";
import { lotFieldData } from "@/lib/lot-db";
import { NoCentreNotice } from "../../../no-centre";

export default async function NewExpensePage() {
  const session = await requireSession();
  if (!canEnter(session.role)) redirect("/vouchers/expenses");
  const { company, centre } = await getActiveScope();
  if (!centre) return <NoCentreNotice companyName={company.name} />;

  const { lots, defaultLotId } = await lotFieldData({
    companyId: company.id,
    centreId: centre.id,
  });

  return (
    <div>
      <h1 className="heading text-xl font-semibold mb-1">New Expense</h1>
      <p className="text-muted text-[13px] mb-4">
        Entering for {company.name} · {centre.name}.
      </p>
      <ExpenseForm
        action={createExpense}
        lots={lots}
        defaultLotId={defaultLotId}
        submitLabel="Save Expense"
        scope={scopeFieldValues({ company, centre })}
      />
    </div>
  );
}
