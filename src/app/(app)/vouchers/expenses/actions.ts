"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { requireAdmin, requireEntry } from "@/lib/session";
import { getActiveScope, requireSubmittedScope } from "@/lib/centre";
import { postLedgerEntries, removeLedgerEntries } from "@/lib/ledger";
import { findOrCreateParty } from "@/lib/party-db";
import {
  EXPENSE_SPECS,
  expensePrepaid,
  expenseVendorName,
} from "@/lib/expense";
import { resolveReviews } from "@/lib/review-db";
import {
  linkStagedAttachment,
  replaceStagedAttachment,
  stageAttachmentFile,
  unlinkAttachments,
  validateImageFile,
} from "@/lib/attachments";

export type ExpenseFormState = { error: string } | null;

type Parsed = {
  categoryId: string;
  /** The category's stable code — picks the entry spec in lib/expense. */
  categoryCode: string;
  categoryName: string;
  amount: Prisma.Decimal;
  /** Of that total, how much was already paid at the time of entry. */
  prepaid: Prisma.Decimal;
  /** The buying day this cost belongs to — drives the ledger and every report. */
  date: Date;
  /** When the money actually went out. Record only; posts to nothing. */
  spentOn: Date;
  notes: string | null;
  details: Record<string, string>;
  vendorName: string;
  file: unknown;
};

const DECIMAL2 = /^\d+(\.\d{1,2})?$/;
const NUMBER = /^\d+(\.\d{1,3})?$/;

// Async now: the category is a row, so validating the submitted id means
// reading it — and reading it scoped to the company, so a tampered form cannot
// file this company's spend under another company's category.
async function parse(
  formData: FormData,
  companyId: string
): Promise<{ error: string } | { data: Parsed }> {
  const categoryId = String(formData.get("categoryId") ?? "");
  const dateRaw = String(formData.get("date") ?? "");
  const spentOnRaw = String(formData.get("spentOn") ?? "");
  const notes = String(formData.get("notes") ?? "").trim();
  const file = formData.get("bill");

  const category = categoryId
    ? await prisma.expenseCategory.findFirst({
        where: { id: categoryId, companyId, archivedAt: null },
        select: { id: true, code: true, name: true },
      })
    : null;
  if (!category) return { error: "Choose a category." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateRaw))
    return { error: "Pick the purchase date this cost belongs to." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(spentOnRaw))
    return { error: "Pick the date the money went out." };
  if (spentOnRaw < dateRaw)
    return {
      error:
        "The expense date is before the purchase date. Check which way round they go.",
    };

  const badFile = validateImageFile(file);
  if (badFile) return { error: badFile };

  // No spec means a category the merchant added themselves: a plain amount,
  // no bespoke fields. That fallback is what lets Masters add one without a
  // deploy.
  const spec = EXPENSE_SPECS[category.code] ?? {
    label: category.name,
    fields: [],
    amountEntered: true,
  };
  const details: Record<string, string> = {};
  for (const f of spec.fields) {
    const raw = String(formData.get(f.name) ?? "").trim().replace(/\s+/g, " ");
    if (f.required && !raw) return { error: `${f.label} is required.` };
    if (raw && f.kind === "number" && (!NUMBER.test(raw) || Number(raw) <= 0))
      return { error: `${f.label} must be a positive number.` };
    if (raw) details[f.name] = raw;
  }

  let amount: Prisma.Decimal;
  if (spec.amountEntered) {
    const amountRaw = String(formData.get("amount") ?? "").trim();
    if (!DECIMAL2.test(amountRaw) || Number(amountRaw) <= 0)
      return { error: "Total must be a positive number (up to 2 decimals)." };
    amount = new Prisma.Decimal(amountRaw);
  } else if (spec.totalFrom) {
    const [q, r] = spec.totalFrom;
    amount = new Prisma.Decimal(details[q]).mul(new Prisma.Decimal(details[r]));
  } else if (spec.totalField) {
    amount = new Prisma.Decimal(details[spec.totalField]);
  } else {
    return { error: "This category has no total configured." };
  }

  // Money already handed over cannot exceed the bill it is paying. Without this
  // the vendor's balance would go positive, reading as "the landlord owes us"
  // on the outstanding screen.
  const prepaid = new Prisma.Decimal(expensePrepaid(category.code, details));
  if (prepaid.greaterThan(amount))
    return {
      error:
        `Advance and collected come to ${prepaid.toFixed(2)}, more than the ` +
        `total of ${amount.toFixed(2)}. Check the figures.`,
    };

  return {
    data: {
      categoryId: category.id,
      categoryCode: category.code,
      categoryName: category.name,
      amount,
      prepaid,
      date: new Date(dateRaw),
      spentOn: new Date(spentOnRaw),
      notes: notes || null,
      details,
      vendorName: expenseVendorName(category.code, category.name, details),
      file,
    },
  };
}

/**
 * Expense ledger effect: CREDIT the vendor, because we now owe them. Settling
 * it is a Payment voucher, not a flag on this record — see postPurchaseLedger.
 *
 * Where the category records money already handed over (vehicle rent: an
 * advance to the driver, and whatever he settles out of his collections), that
 * amount posts back as a DEBIT from the same expense. The vendor's running
 * balance is then the rent still to pay, with no separate "balance" column that
 * could drift from it — and because both sides carry this expense's sourceId,
 * editing or deleting the voucher removes them together.
 */
async function postExpenseLedger(
  tx: Prisma.TransactionClient,
  e: {
    companyId: string;
    centreId: string;
    // Optional now (spec §3.4). An expense with no vendor — a canteen bill, a
    // salary — posts no ledger entry at all, because nothing is owed to
    // anybody. It still counts in profit, which reads the expense table rather
    // than the ledger, so the cost is never lost.
    partyId: string | null;
    id: string;
    amount: Prisma.Decimal;
    prepaid: Prisma.Decimal;
    date: Date;
  }
) {
  if (!e.partyId) return;

  const common = {
    companyId: e.companyId,
    centreId: e.centreId,
    partyId: e.partyId,
    sourceType: "EXPENSE" as const,
    sourceId: e.id,
    date: e.date,
  };

  await postLedgerEntries(tx, [
    { ...common, type: "CREDIT", amount: e.amount },
    ...(e.prepaid.greaterThan(0)
      ? [{ ...common, type: "DEBIT" as const, amount: e.prepaid }]
      : []),
  ]);
}

export async function createExpense(
  _prev: ExpenseFormState,
  formData: FormData
): Promise<ExpenseFormState> {
  const session = await requireEntry();
  // Scope first: parse validates the category against this company, so the
  // company has to be known before parsing rather than after.
  const scoped = await requireSubmittedScope(formData);
  if ("error" in scoped) return { error: scoped.error };
  const { company, centre } = scoped.scope;
  const parsed = await parse(formData, company.id);
  if ("error" in parsed) return { error: parsed.error };
  const d = parsed.data;

  try {
    // Staged before the transaction so a rejected image aborts the save
    // instead of leaving an expense with no receipt against it.
    const staged = await stageAttachmentFile(d.file);
    await prisma.$transaction(async (tx) => {
      const partyId = await findOrCreateParty(tx, d.vendorName, "EXPENSE_VENDOR");
      const expense = await tx.expense.create({
        data: {
          companyId: company.id,
          centreId: centre.id,
          partyId,
          categoryId: d.categoryId,
          amount: d.amount,
          date: d.date,
          spentOn: d.spentOn,
          notes: d.notes,
          details: d.details,
          createdById: session.userId,
        },
      });
      await postExpenseLedger(tx, { ...expense, ...d });
      await linkStagedAttachment(tx, staged, {
        companyId: company.id,
        centreId: centre.id,
        linkedType: "EXPENSE",
        linkedId: expense.id,
      });
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not save expense." };
  }

  revalidatePath("/vouchers/expenses");
  revalidatePath("/ledgers", "layout");
  redirect("/vouchers/expenses");
}

/**
 * Delete an expense outright. Ledger entries first so the vendor's running
 * balance is rebuilt without it — see deletePurchase for why the order matters.
 */
export async function deleteExpense(
  expenseId: string,
  _prev: ExpenseFormState
): Promise<ExpenseFormState> {
  const session = await requireAdmin();

  const { company, centre } = await getActiveScope();
  if (!centre) return { error: "No centre is selected." };

  try {
    await prisma.$transaction(async (tx) => {
      const existing = await tx.expense.findFirst({
        // Scoped: an admin may only change or remove a voucher that belongs to
        // the company and centre they are currently working in.
        where: { id: expenseId, companyId: company.id, centreId: centre.id },
        select: { id: true },
      });
      if (!existing) throw new Error("Expense not found.");

      await removeLedgerEntries(tx, { sourceId: expenseId });
      await unlinkAttachments(tx, "EXPENSE", expenseId);
      // Removing the voucher answers any request against it. The request rows
      // themselves survive — they record that a correction was asked for.
      await resolveReviews(tx, "EXPENSE", expenseId, session.userId);
      await tx.expense.delete({ where: { id: expenseId } });
    });
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "Could not delete expense.",
    };
  }

  revalidatePath("/vouchers/expenses");
  revalidatePath("/ledgers", "layout");
  revalidatePath("/dashboard");
  redirect("/vouchers/expenses");
}

export async function updateExpense(
  expenseId: string,
  _prev: ExpenseFormState,
  formData: FormData
): Promise<ExpenseFormState> {
  const session = await requireAdmin();
  const { company, centre } = await getActiveScope();
  if (!centre) return { error: "No centre is selected." };

  const parsed = await parse(formData, company.id);
  if ("error" in parsed) return { error: parsed.error };
  const d = parsed.data;

  try {
    const staged = await stageAttachmentFile(d.file);
    await prisma.$transaction(async (tx) => {
      const existing = await tx.expense.findFirst({
        where: { id: expenseId, companyId: company.id, centreId: centre.id },
      });
      if (!existing) throw new Error("Expense not found.");

      // Rebuilds the old vendor's statement too, in case this edit moves the
      // expense to a different vendor.
      await removeLedgerEntries(tx, {
        sourceId: expenseId,
        sourceType: ["EXPENSE", "PAYMENT"],
      });
      const partyId = await findOrCreateParty(tx, d.vendorName, "EXPENSE_VENDOR");
      const expense = await tx.expense.update({
        where: { id: expenseId },
        data: {
          partyId,
          categoryId: d.categoryId,
          amount: d.amount,
          date: d.date,
          spentOn: d.spentOn,
          notes: d.notes,
          details: d.details,
          updatedById: session.userId,
          updatedAt: new Date(),
        },
      });
      await postExpenseLedger(tx, { ...expense, ...d });
      // A newly chosen image replaces the old receipt rather than piling up
      // beside it; leaving the field empty keeps whatever is attached.
      await replaceStagedAttachment(tx, staged, {
        companyId: existing.companyId,
        centreId: existing.centreId,
        linkedType: "EXPENSE",
        linkedId: expenseId,
      });
      // The edit *is* the answer to any review request against this expense,
      // so a successful save closes it. In the same transaction: a save that
      // rolls back leaves the request standing.
      await resolveReviews(tx, "EXPENSE", expenseId, session.userId);
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not save expense." };
  }

  revalidatePath("/vouchers/expenses");
  revalidatePath("/ledgers", "layout");
  revalidatePath("/dashboard");
  redirect("/vouchers/expenses");
}
