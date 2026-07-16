import type { ExpenseCategory } from "@/generated/prisma/enums";

export const EXPENSE_CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  LOADERS: "Loaders",
  WORKERS: "Workers",
  ICE: "Ice",
  CANTEEN: "Canteen",
  RENT: "Rent",
  TRANSPORT: "Transport",
  FUEL: "Fuel",
  MISC: "Miscellaneous",
};

export const EXPENSE_CATEGORIES = Object.keys(
  EXPENSE_CATEGORY_LABELS
) as ExpenseCategory[];
