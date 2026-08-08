import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getActiveScope, scopeFieldValues } from "@/lib/centre";
import { canEdit, canEnter, requireSession } from "@/lib/session";
import { fmtDate, fmtMoney, toInputDate } from "@/lib/format";
import { deleteExpense, updateExpense } from "../actions";
import { ExpenseForm } from "../expense-form";
import { getAttachments } from "@/lib/attachments";
import { uploadAttachment } from "../../../attachments/actions";
import { AttachmentPanel } from "../../../attachments/attachment-panel";
import { DeleteVoucher } from "../../delete-voucher";
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
      createdBy: { select: { name: true } },
      updatedBy: { select: { name: true } },
    },
  });
  if (!expense) notFound();

  // Historic flags from the old closed-day correction flow are still honoured.
  const flag = await prisma.errorFlag.findUnique({
    where: {
      linkedType_linkedId: { linkedType: "EXPENSE", linkedId: expense.id },
    },
  });

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

  if (!mayEdit) {
    const details = (expense.details as Record<string, string> | null) ?? {};
    return (
      <div>
        <h1 className="heading text-xl font-semibold mb-4">Expense</h1>
        <dl className="border border-line-strong bg-surface divide-y divide-line max-w-lg text-[13px]">
          <Row label="Category" value={expense.category} />
          <Row label="Vendor" value={expense.party.name} />
          <Row label="Date" value={fmtDate(expense.date)} />
          <Row label="Amount" value={fmtMoney(expense.amount)} />
          {Object.entries(details).map(([k, v]) => (
            <Row key={k} label={k} value={String(v)} />
          ))}
          {expense.notes && <Row label="Notes" value={expense.notes} />}
        </dl>
        {meta}
        {panel}
      </div>
    );
  }

  const initial = {
    category: expense.category,
    amount: expense.amount.toString(),
    date: toInputDate(expense.date),
    notes: expense.notes,
    details: (expense.details as Record<string, string> | null) ?? {},
  };

  return (
    <div>
      <h1 className="heading text-xl font-semibold mb-4">Edit Expense</h1>
      <ExpenseForm
        action={updateExpense.bind(null, expense.id)}
        initial={initial}
        submitLabel="Save Changes"
        scope={scopeFieldValues({ company, centre })}
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
