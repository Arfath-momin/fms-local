import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { toInputDate } from "@/lib/format";
import { correctExpense, updateExpense } from "../actions";
import { ExpenseForm } from "../expense-form";
import { getAttachments } from "@/lib/attachments";
import { uploadAttachment } from "../../../attachments/actions";
import { AttachmentPanel } from "../../../attachments/attachment-panel";

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

  const [dayClose, flag] = await Promise.all([
    prisma.dayClose.findUnique({
      where: {
        companyId_date: { companyId: expense.companyId, date: expense.date },
      },
    }),
    prisma.errorFlag.findUnique({
      where: {
        linkedType_linkedId: { linkedType: "EXPENSE", linkedId: expense.id },
      },
    }),
  ]);

  if (flag) {
    return (
      <div>
        <h1 className="heading text-xl font-semibold mb-4">Expense</h1>
        <div className="text-[13px] border border-debit bg-surface px-4 py-3 max-w-lg">
          <p className="font-semibold text-debit">
            This expense was flagged as an error and corrected.
          </p>
          {flag.reason && (
            <p className="mt-1 text-muted">Reason: {flag.reason}</p>
          )}
          {flag.correctingEntryId && (
            <p className="mt-1">
              <Link
                href={`/vouchers/expenses/${flag.correctingEntryId}`}
                className="text-accent underline underline-offset-2"
              >
                View the corrected entry →
              </Link>
            </p>
          )}
        </div>
      </div>
    );
  }

  const initial = {
    category: expense.category,
    amount: expense.amount.toString(),
    date: toInputDate(expense.date),
    paid: expense.paid,
    notes: expense.notes,
    details: (expense.details as Record<string, string> | null) ?? {},
  };

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
        expense.companyId,
        `/vouchers/expenses/${expense.id}`
      )}
      canUpload
    />
  );

  if (dayClose) {
    return (
      <div>
        <h1 className="heading text-xl font-semibold mb-1">
          Correct Expense (closed day)
        </h1>
        <p className="text-[13px] text-muted mb-4 max-w-lg">
          This day is closed, so the original entry cannot be edited. Saving
          here flags the original as an error — it stays visible,
          struck-through — and records this corrected entry in its place.
        </p>
        <ExpenseForm
          action={correctExpense.bind(null, expense.id)}
          initial={initial}
          submitLabel="Flag Original & Save Correction"
          reasonField
        />
        {panel}
      </div>
    );
  }

  return (
    <div>
      <h1 className="heading text-xl font-semibold mb-4">Edit Expense</h1>
      <ExpenseForm
        action={updateExpense.bind(null, expense.id)}
        initial={initial}
        submitLabel="Save Changes"
      />
      {panel}
    </div>
  );
}
