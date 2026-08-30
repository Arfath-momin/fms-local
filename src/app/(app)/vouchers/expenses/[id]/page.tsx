import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { tripOptions } from "@/lib/trip";
import { getActiveScope, scopeFieldValues } from "@/lib/centre";
import { canEdit, canEnter, requireSession } from "@/lib/session";
import { fmtDate, fmtMoney, toInputDate } from "@/lib/format";
import { deleteExpense, updateExpense } from "../actions";
import { ExpenseForm } from "../expense-form";
import { getAttachments } from "@/lib/attachments";
import { uploadAttachment } from "../../../attachments/actions";
import { AttachmentPanel } from "../../../attachments/attachment-panel";
import { DeleteVoucher } from "../../delete-voucher";
import { ReviewPanel } from "../../review-panel";
import { VoucherMeta } from "../../voucher-meta";

export default async function ExpenseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireSession();
  const mayEdit = canEdit(session.role);
  const mayEnter = canEnter(session.role);

  const { id } = await params;
  const { company, centre } = await getActiveScope();
  if (!centre) notFound();

  const expense = await prisma.expense.findFirst({
    // Scoped, not just found by id. A voucher belonging to another company or
    // centre must not open — let alone be editable — from the scope you are in.
    where: { id, companyId: company.id, centreId: centre.id },
    include: {
      party: { select: { name: true } },
      category: { select: { id: true, code: true, name: true } },
      lines: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }] },
      createdBy: { select: { name: true } },
      updatedBy: { select: { name: true } },
    },
  });
  if (!expense) notFound();


  const attachments = await getAttachments("EXPENSE", expense.id);
  const panel = (
    <AttachmentPanel
      attachments={attachments.map((a) => ({
        id: a.id,
        uploadedAt: a.uploadedAt.toISOString(),
      }))}
      action={uploadAttachment.bind(
        null,
        "EXPENSE",
        expense.id,
        `/vouchers/expenses/${expense.id}`
      )}
      canUpload={mayEnter}
    />
  );

  const meta = (
    <VoucherMeta
      createdBy={expense.createdBy}
      createdAt={expense.createdAt}
      updatedBy={expense.updatedBy}
      updatedAt={expense.updatedAt}
    />
  );

  // The accountant's route to a correction, since they cannot edit. For an
  // admin this is the notice that one was asked for.
  const review = (
    <ReviewPanel linkedType="EXPENSE" linkedId={expense.id} noun="expense" />
  );

  if (!mayEdit) {
    const details = (expense.details as Record<string, string> | null) ?? {};
    return (
      <div>
        <h1 className="heading text-xl font-semibold mb-4">Expense</h1>
        <dl className="border border-line-strong bg-surface divide-y divide-line max-w-lg text-[13px]">
          <Row label="Category" value={expense.category.name} />
          {/* Optional now — a canteen bill or a salary has no vendor. */}
          {expense.party && <Row label="Vendor" value={expense.party.name} />}
          <Row label="Purchase Date" value={fmtDate(expense.date)} />
          <Row
            label="Expense Date"
            value={fmtDate(expense.spentOn ?? expense.date)}
          />
          <Row label="Amount" value={fmtMoney(expense.amount)} />
          {Object.entries(details).map(([k, v]) => (
            <Row key={k} label={k} value={String(v)} />
          ))}
          {/* An itemised expense: the rows that sum into the total above. */}
          {expense.lines.map((l) => (
            <Row key={l.id} label={l.description} value={fmtMoney(l.amount)} />
          ))}
          {expense.notes && <Row label="Notes" value={expense.notes} />}
        </dl>
        {meta}
        {panel}
        {review}
      </div>
    );
  }


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

  // The same list the new-expense screen offers. Without it the trip picker
  // never rendered here, so saving an edit submitted no trip and cleared a link
  // the voucher already had.
  const trips = await tripOptions({ companyId: company.id, centreId: centre.id });

  const initial = {
    categoryId: expense.categoryId,
    deliveryNoteId: expense.deliveryNoteId,
    lines: expense.lines.map((l) => ({
      description: l.description,
      amount: l.amount.toString(),
    })),
    amount: expense.amount.toString(),
    date: toInputDate(expense.date),
    spentOn: toInputDate(expense.spentOn ?? expense.date),
    notes: expense.notes,
    details: (expense.details as Record<string, string> | null) ?? {},
  };

  return (
    <div>
      <h1 className="heading text-xl font-semibold mb-4">Edit Expense</h1>
      {/* Above the form, not below it: it is the reason this screen is open.
          Collapses to nothing when no review was requested. */}
      <div className="mb-4 empty:hidden [&>*]:mt-0">{review}</div>
      <ExpenseForm
        categories={categories}
        action={updateExpense.bind(null, expense.id)}
        initial={initial}
        trips={trips}
        submitLabel="Save Changes"
        scope={scopeFieldValues({ company, centre })}
        // The Attachments panel below is the single place images are managed
        // once the voucher exists.
        allowBillUpload={false}
      />
      {meta}
      {panel}
      <DeleteVoucher
        action={deleteExpense.bind(null, expense.id)}
        noun="expense"
      />
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 px-4 py-2">
      <dt className="text-muted">{label}</dt>
      <dd className="font-semibold">{value}</dd>
    </div>
  );
}
