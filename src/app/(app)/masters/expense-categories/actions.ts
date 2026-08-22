"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Prisma } from "@/generated/prisma/client";
import type { ExpenseKind } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { requireAdmin, requireSuperAdmin } from "@/lib/session";
import { getActiveCompany } from "@/lib/company";

export type CategoryFormState = { error: string } | null;

const KINDS: ExpenseKind[] = ["DIRECT", "OVERHEAD"];

/**
 * Codes are uppercase and separator-free, like vehicle numbers and for the same
 * reason: the code is the identity — it picks the entry spec in lib/expense and
 * appears in URLs — so "office rent" and "OFFICE_RENT" must not be two things.
 */
function normaliseCode(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function parse(
  formData: FormData
): { error: string } | { code: string; name: string; kind: ExpenseKind; allowsLines: boolean } {
  const name = String(formData.get("name") ?? "").trim().replace(/\s+/g, " ");
  const kindRaw = String(formData.get("kind") ?? "");
  const allowsLines = String(formData.get("allowsLines") ?? "") === "on";

  if (!name) return { error: "Enter a name for the category." };
  if (!KINDS.includes(kindRaw as ExpenseKind))
    return { error: "Choose whether this is a direct cost or an overhead." };

  // The code defaults to the name when not given, which is what a merchant
  // adding "Electricity" expects — they should not have to think about codes.
  const code = normaliseCode(String(formData.get("code") ?? "") || name);
  if (!code) return { error: "That name has no letters or digits to make a code from." };

  return { code, name, kind: kindRaw as ExpenseKind, allowsLines };
}

/**
 * Add an expense category to the active company.
 *
 * Categories were an enum, which meant adding "Electricity" was a migration and
 * a deploy — and gave nowhere to record whether a cost belongs to a buying day
 * or to the month. Both are the same problem: a category is data the merchant
 * owns, not a fact about the code.
 */
export async function createExpenseCategory(
  _prev: CategoryFormState,
  formData: FormData
): Promise<CategoryFormState> {
  await requireAdmin();
  const parsed = parse(formData);
  if ("error" in parsed) return parsed;

  const company = await getActiveCompany();
  try {
    // Appended to the end of the merchant's own ordering.
    const last = await prisma.expenseCategory.findFirst({
      where: { companyId: company.id },
      orderBy: { sortOrder: "desc" },
      select: { sortOrder: true },
    });
    await prisma.expenseCategory.create({
      data: {
        companyId: company.id,
        code: parsed.code,
        name: parsed.name,
        kind: parsed.kind,
        allowsLines: parsed.allowsLines,
        sortOrder: (last?.sortOrder ?? 0) + 1,
      },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")
      return {
        error: `${company.name} already has a category coded ${parsed.code}.`,
      };
    return { error: e instanceof Error ? e.message : "Could not add category." };
  }

  revalidatePath("/masters/expense-categories");
  redirect("/masters/expense-categories");
}

/**
 * Rename a category or move it between tiers.
 *
 * Changing the KIND is the consequential one: it moves every expense already
 * filed under it between gross and net profit, which restates the daily figure
 * for every day it appears on. Admin only, and the screen says so.
 */
export async function updateExpenseCategory(
  categoryId: string,
  _prev: CategoryFormState,
  formData: FormData
): Promise<CategoryFormState> {
  await requireAdmin();
  const parsed = parse(formData);
  if ("error" in parsed) return parsed;

  const company = await getActiveCompany();
  try {
    const existing = await prisma.expenseCategory.findFirst({
      where: { id: categoryId, companyId: company.id },
      select: { id: true },
    });
    if (!existing) return { error: "That category no longer exists." };

    await prisma.expenseCategory.update({
      where: { id: categoryId },
      data: {
        code: parsed.code,
        name: parsed.name,
        kind: parsed.kind,
        allowsLines: parsed.allowsLines,
      },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")
      return {
        error: `${company.name} already has a category coded ${parsed.code}.`,
      };
    return { error: e instanceof Error ? e.message : "Could not save category." };
  }

  revalidatePath("/masters/expense-categories");
  redirect("/masters/expense-categories");
}

async function categoryUsage(categoryId: string, companyId: string) {
  const c = await prisma.expenseCategory.findFirst({
    where: { id: categoryId, companyId },
    select: {
      name: true,
      code: true,
      archivedAt: true,
      _count: { select: { expenses: true } },
    },
  });
  if (!c) return null;
  return {
    name: c.name,
    code: c.code,
    archivedAt: c.archivedAt,
    expenses: c._count.expenses,
  };
}

/** Retire a category. Its expenses stay and every report reads unchanged. */
export async function archiveExpenseCategory(
  categoryId: string,
  _prev: CategoryFormState,
  _formData: FormData
): Promise<CategoryFormState> {
  await requireAdmin();
  const company = await getActiveCompany();

  const usage = await categoryUsage(categoryId, company.id);
  if (!usage) return { error: "That category no longer exists." };
  if (usage.archivedAt) return { error: `${usage.name} is already archived.` };

  // RENT is not optional. Every trip files its rent under it, so a trip saved
  // after this would fail with an error the merchant could not act on.
  if (usage.code === "RENT")
    return {
      error:
        "Vehicle Rent cannot be archived — every trip files its rent under it.",
    };

  await prisma.expenseCategory.update({
    where: { id: categoryId },
    data: { archivedAt: new Date() },
  });
  revalidatePath("/masters/expense-categories");
  return null;
}

/** Bring an archived category back into the expense form. Super admin only. */
export async function unarchiveExpenseCategory(
  categoryId: string,
  _prev: CategoryFormState,
  _formData: FormData
): Promise<CategoryFormState> {
  await requireSuperAdmin();
  const company = await getActiveCompany();

  const usage = await categoryUsage(categoryId, company.id);
  if (!usage) return { error: "That category no longer exists." };

  await prisma.expenseCategory.update({
    where: { id: categoryId },
    data: { archivedAt: null },
  });
  revalidatePath("/masters/expense-categories");
  return null;
}

/**
 * Delete a category for good — super admin only, and only when nothing is
 * filed under it. One with even a single expense is archived instead: deleting
 * it would take the category off rows that still count in every report.
 */
export async function deleteExpenseCategory(
  categoryId: string,
  _prev: CategoryFormState,
  _formData: FormData
): Promise<CategoryFormState> {
  await requireSuperAdmin();
  const company = await getActiveCompany();

  const usage = await categoryUsage(categoryId, company.id);
  if (!usage) return { error: "That category no longer exists." };
  if (usage.expenses > 0)
    return {
      error:
        `${usage.name} holds ${usage.expenses} expense${usage.expenses === 1 ? "" : "s"} ` +
        `and cannot be deleted — archive it instead, which takes it out of the ` +
        `voucher form while every report keeps reading as it does now.`,
    };

  await prisma.expenseCategory.delete({ where: { id: categoryId } });
  revalidatePath("/masters/expense-categories");
  return null;
}
