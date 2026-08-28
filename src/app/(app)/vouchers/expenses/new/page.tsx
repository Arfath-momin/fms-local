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
  // RENT is in the list. Vehicle rent is an ordinary expense voucher again —
  // agreed when the truck is loaded, entered then, for every channel. See the
  // note on the RENT spec in src/lib/expense.ts for why it left the trip.
  const categories = await prisma.expenseCategory.findMany({
    where: {
      companyId: company.id,
      archivedAt: null,
    },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, code: true, name: true, allowsLines: true, kind: true },
  });

  // Open trips of every channel, so a Vehicle Rent voucher can fill itself in
  // from one: the vehicle, the transporter, the buying day and the advance
  // already handed over at loading. Only the total is left to type.
  const trips = (
    await prisma.deliveryNote.findMany({
      where: { companyId: company.id, centreId: centre.id },
      orderBy: [{ date: "desc" }, { billNo: "desc" }],
      take: 60,
      select: {
        id: true,
        billNo: true,
        date: true,
        advancePaid: true,
        vehicle: {
          select: { number: true, transporter: { select: { name: true } } },
        },
      },
    })
  ).map((t) => ({
    id: t.id,
    billNo: t.billNo,
    date: t.date.toISOString().slice(0, 10),
    vehicleNumber: t.vehicle.number,
    transporterName: t.vehicle.transporter.name,
    advancePaid: Number(t.advancePaid ?? 0),
  }));

  // The vehicle master, so a rent voucher picks the truck rather than typing a
  // number that has to match one somewhere else.
  const vehicles = (
    await prisma.vehicle.findMany({
      where: { companyId: company.id, archivedAt: null },
      orderBy: { number: "asc" },
      select: {
        id: true,
        number: true,
        transporter: { select: { name: true } },
      },
    })
  ).map((v) => ({
    id: v.id,
    number: v.number,
    transporterName: v.transporter.name,
  }));

  return (
    <div>
      <h1 className="heading text-xl font-semibold mb-1">New Expense</h1>
      <p className="text-muted text-[13px] mb-4">
        Entering for {company.name} · {centre.name}.
      </p>
      <ExpenseForm
        action={createExpense}
        categories={categories}
        trips={trips}
        vehicles={vehicles}
        submitLabel="Save Expense"
        scope={scopeFieldValues({ company, centre })}
      />
    </div>
  );
}
