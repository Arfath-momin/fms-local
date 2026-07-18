"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Prisma } from "@/generated/prisma/client";
import type { ExpenseCategory } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { requireMerchant } from "@/lib/session";
import { getActiveCompany } from "@/lib/company";
import { assertDayOpen } from "@/lib/dayclose";
import { EXPENSE_CATEGORIES } from "@/lib/expense";

export type ExpenseFormState = { error: string } | null;

type Parsed = {
  category: ExpenseCategory;
  amount: Prisma.Decimal;
  date: Date;
  notes: string | null;
};

function parse(formData: FormData): { error: string } | { data: Parsed } {
  const category = String(formData.get("category") ?? "") as ExpenseCategory;
  const amountRaw = String(formData.get("amount") ?? "").trim();
  const dateRaw = String(formData.get("date") ?? "");
  const notes = String(formData.get("notes") ?? "").trim();

  if (!EXPENSE_CATEGORIES.includes(category))
    return { error: "Choose a category." };
  if (!/^\d+(\.\d{1,2})?$/.test(amountRaw) || Number(amountRaw) <= 0)
    return { error: "Amount must be a positive number (up to 2 decimals)." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateRaw)) return { error: "Pick a date." };

  return {
    data: {
      category,
      amount: new Prisma.Decimal(amountRaw),
      date: new Date(dateRaw),
      notes: notes || null,
    },
  };
}

export async function createExpense(
  _prev: ExpenseFormState,
  formData: FormData
): Promise<ExpenseFormState> {
  await requireMerchant();
  const parsed = parse(formData);
  if ("error" in parsed) return { error: parsed.error };
  const company = await getActiveCompany();

  try {
    await prisma.$transaction(async (tx) => {
      await assertDayOpen(tx, company.id, parsed.data.date);
      await tx.expense.create({
        data: { companyId: company.id, ...parsed.data },
      });
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not save expense." };
  }

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
  const reason = String(formData.get("reason") ?? "").trim();

  try {
    await prisma.$transaction(async (tx) => {
      const original = await tx.expense.findUnique({ where: { id: expenseId } });
      if (!original) throw new Error("Expense not found.");

      const already = await tx.errorFlag.findUnique({
        where: { linkedType_linkedId: { linkedType: "EXPENSE", linkedId: expenseId } },
      });
      if (already) throw new Error("This expense has already been corrected.");

      const flag = await tx.errorFlag.create({
        data: {
          linkedType: "EXPENSE",
          linkedId: expenseId,
          reason: reason || null,
        },
      });
      const replacement = await tx.expense.create({
        data: { companyId: original.companyId, ...parsed.data },
      });
      await tx.errorFlag.update({
        where: { id: flag.id },
        data: { correctingEntryId: replacement.id },
      });
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not save correction." };
  }

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

  try {
    await prisma.$transaction(async (tx) => {
      const existing = await tx.expense.findUnique({ where: { id: expenseId } });
      if (!existing) throw new Error("Expense not found.");
      await assertDayOpen(tx, existing.companyId, existing.date);
      await assertDayOpen(tx, existing.companyId, parsed.data.date);
      await tx.expense.update({ where: { id: expenseId }, data: parsed.data });
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not save expense." };
  }

  revalidatePath("/vouchers/expenses");
  redirect("/vouchers/expenses");
}
