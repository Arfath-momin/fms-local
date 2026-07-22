import type { ExpenseCategory } from "@/generated/prisma/enums";

export const EXPENSE_CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  ICE: "Ice",
  LOADERS: "Loaders",
  LADIES: "Ladies",
  BATHA: "Batha",
  CANTEEN: "Canteen",
  RENT: "Rent",
};

export const EXPENSE_CATEGORIES = Object.keys(
  EXPENSE_CATEGORY_LABELS
) as ExpenseCategory[];

export type ExpenseFieldSpec = {
  name: string; // form field name + key inside details JSON
  label: string;
  kind: "text" | "number";
  required: boolean;
};

export type ExpenseCategorySpec = {
  label: string;
  fields: ExpenseFieldSpec[];
  /** [qtyKey, rateKey] → total = qty × rate. */
  totalFrom?: [string, string];
  /** detail key whose value IS the total (entered, not multiplied). */
  totalField?: string;
  /** true → merchant types the total directly in an Amount field. */
  amountEntered: boolean;
  /** detail key whose value names the vendor ledger; falls back to label. */
  vendorFrom?: string;
  /** shown under the Batha form until its fields are defined. */
  note?: string;
};

const t = (name: string, label: string, required = true): ExpenseFieldSpec => ({
  name,
  label,
  kind: "text",
  required,
});
const n = (name: string, label: string, required = true): ExpenseFieldSpec => ({
  name,
  label,
  kind: "number",
  required,
});

// Per-category entry shapes (client spec). `details` stores every field; the
// ledger + Profit report only ever read `amount` (the computed/entered total).
export const EXPENSE_SPECS: Record<ExpenseCategory, ExpenseCategorySpec> = {
  ICE: {
    label: "Ice",
    fields: [
      t("slNo", "SL No", false),
      t("vehicleNo", "Vehicle No", false),
      t("plantName", "Ice Plant Name"),
      n("blocks", "No. of Blocks"),
      n("ratePerBlock", "Rate / Block"),
    ],
    totalFrom: ["blocks", "ratePerBlock"],
    amountEntered: false,
    vendorFrom: "plantName",
  },
  LOADERS: {
    label: "Loaders",
    fields: [n("boxes", "No. of Boxes"), n("ratePerBox", "Rate / Box")],
    totalFrom: ["boxes", "ratePerBox"],
    amountEntered: false,
  },
  LADIES: {
    label: "Ladies",
    fields: [n("boxes", "No. of Boxes"), n("ratePerBox", "Rate / Box")],
    totalFrom: ["boxes", "ratePerBox"],
    amountEntered: false,
  },
  BATHA: {
    label: "Batha",
    fields: [],
    amountEntered: true,
    note: "Batha fields to be defined by the client — enter the total for now.",
  },
  CANTEEN: {
    label: "Canteen",
    fields: [],
    amountEntered: true,
  },
  RENT: {
    label: "Rent",
    fields: [t("slNo", "SL No", false), t("vehicleNo", "Vehicle No"), n("rent", "Rent")],
    totalField: "rent",
    amountEntered: false,
    vendorFrom: "vehicleNo",
  },
};

/** Ledger/party name for an expense — the vendor field where given, else the category. */
export function expenseVendorName(
  category: ExpenseCategory,
  details: Record<string, string>
): string {
  const spec = EXPENSE_SPECS[category];
  const v = spec.vendorFrom ? details[spec.vendorFrom]?.trim() : "";
  return v || spec.label;
}
