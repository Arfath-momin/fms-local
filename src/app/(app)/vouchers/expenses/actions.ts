"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Prisma } from "@/generated/prisma/client";
import type { ExpenseCategory } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { requireMerchant } from "@/lib/session";
import { getActiveCompany } from "@/lib/company";
import { assertDayOpen } from "@/lib/dayclose";
import { postLedgerEntry } from "@/lib/ledger";
import { findOrCreateParty } from "@/lib/party-db";
import { EXPENSE_CATEGORIES, EXPENSE_SPECS, expenseVendorName } from "@/lib/expense";
import { saveAttachmentFile, validateImageFile } from "@/lib/attachments";

export type ExpenseFormState = { error: string } | null;

type Parsed = {
  category: ExpenseCategory;
  amount: Prisma.Decimal;
  paid: boolean;
  date: Date;
  notes: string | null;
  details: Record<string, string>;
  vendorName: string;
  file: unknown;
};

const DECIMAL2 = /^\d+(\.\d{1,2})?$/;
const NUMBER = /^\d+(\.\d{1,3})?$/;

function parse(formData: FormData): { error: string } | { data: Parsed } {
  const category = String(formData.get("category") ?? "") as ExpenseCategory;
  const dateRaw = String(formData.get("date") ?? "");
  const paid = formData.get("paid") != null;
  const notes = String(formData.get("notes") ?? "").trim();
  const file = formData.get("bill");

  if (!EXPENSE_CATEGORIES.includes(category))
    return { error: "Choose a category." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateRaw)) return { error: "Pick a date." };

  const badFile = validateImageFile(file);
  if (badFile) return { error: badFile };

  const spec = EXPENSE_SPECS[category];
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

  return {
    data: {
      category,
      amount,
      paid,
      date: new Date(dateRaw),
      notes: notes || null,
      details,
      vendorName: expenseVendorName(category, details),
      file,
    },
  };
}

/** Expense ledger effect: CREDIT the vendor; DEBIT PAYMENT when paid. */
async function postExpenseLedger(
  tx: Prisma.TransactionClient,
  e: { companyId: string; partyId: string; id: string; amount: Prisma.Decimal; date: Date; paid: boolean }
) {
  await postLedgerEntry(tx, {
    companyId: e.companyId,
    partyId: e.partyId,
    type: "CREDIT",
    sourceType: "EXPENSE",
    sourceId: e.id,
    amount: e.amount,
    date: e.date,
  });
  if (e.paid) {
    await postLedgerEntry(tx, {
      companyId: e.companyId,
      partyId: e.partyId,
      type: "DEBIT",
      sourceType: "PAYMENT",
      sourceId: e.id,
      amount: e.amount,
      date: e.date,
    });
  }
}

export async function createExpense(
  _prev: ExpenseFormState,
  formData: FormData
): Promise<ExpenseFormState> {
  await requireMerchant();
  const parsed = parse(formData);
  if ("error" in parsed) return { error: parsed.error };
  const d = parsed.data;
  const company = await getActiveCompany();

  let expenseId: string;
  try {
    expenseId = await prisma.$transaction(async (tx) => {
      await assertDayOpen(tx, company.id, d.date);
      const partyId = await findOrCreateParty(tx, d.vendorName, "EXPENSE_VENDOR");
      const expense = await tx.expense.create({
        data: {
          companyId: company.id,
          partyId,
          category: d.category,
          amount: d.amount,
          paid: d.paid,
          date: d.date,
          notes: d.notes,
          details: d.details,
        },
      });
      await postExpenseLedger(tx, { ...expense, ...d });
      return expense.id;
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not save expense." };
  }

  await saveAttachmentFile({
    companyId: company.id,
    linkedType: "EXPENSE",
    linkedId: expenseId,
    file: d.file,
  });

  revalidatePath("/vouchers/expenses");
  redirect("/vouchers/expenses");
}

export async function updateExpense(
  expenseId: string,
  _prev: ExpenseFormState,
  formData: FormData
): Promise<ExpenseFormState> {
  await requireMerchant();
  const parsed = parse(formData);
  if ("error" in parsed) return { error: parsed.error };
  const d = parsed.data;

  let companyId: string;
  try {
    companyId = await prisma.$transaction(async (tx) => {
      const existing = await tx.expense.findUnique({ where: { id: expenseId } });
      if (!existing) throw new Error("Expense not found.");
      await assertDayOpen(tx, existing.companyId, existing.date);
      await assertDayOpen(tx, existing.companyId, d.date);

      await tx.ledgerEntry.deleteMany({
        where: { sourceId: expenseId, sourceType: { in: ["EXPENSE", "PAYMENT"] } },
      });
      const partyId = await findOrCreateParty(tx, d.vendorName, "EXPENSE_VENDOR");
      const expense = await tx.expense.update({
        where: { id: expenseId },
        data: {
          partyId,
          category: d.category,
          amount: d.amount,
          paid: d.paid,
          date: d.date,
          notes: d.notes,
          details: d.details,
        },
      });
      await postExpenseLedger(tx, { ...expense, ...d });
      return existing.companyId;
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not save expense." };
  }

  await saveAttachmentFile({
    companyId,
    linkedType: "EXPENSE",
    linkedId: expenseId,
    file: d.file,
  });

  revalidatePath("/vouchers/expenses");
  redirect("/vouchers/expenses");
}

/** Closed-day correction: flag original, create linked replacement. */
export async function correctExpense(
  expenseId: string,
  _prev: ExpenseFormState,
  formData: FormData
): Promise<ExpenseFormState> {
  await requireMerchant();
  const parsed = parse(formData);
  if ("error" in parsed) return { error: parsed.error };
  const d = parsed.data;
  const reason = String(formData.get("reason") ?? "").trim();

  let replacementId: string;
  let companyId: string;
  try {
    const result = await prisma.$transaction(async (tx) => {
      const original = await tx.expense.findUnique({ where: { id: expenseId } });
      if (!original) throw new Error("Expense not found.");

      const already = await tx.errorFlag.findUnique({
        where: { linkedType_linkedId: { linkedType: "EXPENSE", linkedId: expenseId } },
      });
      if (already) throw new Error("This expense has already been corrected.");

      const flag = await tx.errorFlag.create({
        data: { linkedType: "EXPENSE", linkedId: expenseId, reason: reason || null },
      });
      await tx.ledgerEntry.deleteMany({
        where: { sourceId: expenseId, sourceType: { in: ["EXPENSE", "PAYMENT"] } },
      });
      const partyId = await findOrCreateParty(tx, d.vendorName, "EXPENSE_VENDOR");
      const replacement = await tx.expense.create({
        data: {
          companyId: original.companyId,
          partyId,
          category: d.category,
          amount: d.amount,
          paid: d.paid,
          date: d.date,
          notes: d.notes,
          details: d.details,
        },
      });
      await postExpenseLedger(tx, { ...replacement, ...d });
      await tx.errorFlag.update({
        where: { id: flag.id },
        data: { correctingEntryId: replacement.id },
      });
      return { replacementId: replacement.id, companyId: original.companyId };
    });
    replacementId = result.replacementId;
    companyId = result.companyId;
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not save correction." };
  }

  await saveAttachmentFile({
    companyId,
    linkedType: "EXPENSE",
    linkedId: replacementId,
    file: d.file,
  });

  revalidatePath("/vouchers/expenses");
  redirect("/vouchers/expenses");
}
