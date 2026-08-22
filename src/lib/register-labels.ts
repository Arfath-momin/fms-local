import { SETTLEMENT_MODE_LABELS } from "@/lib/settlement";
import { PURCHASE_TYPE_LABELS } from "@/lib/purchase";
import { SALE_TYPE_LABELS } from "@/lib/sale";

/**
 * How a register row is named on screen and on paper.
 *
 * Extracted from the register page because the printable view renders the same
 * rows: two copies would drift, and a report whose print-out disagrees with the
 * screen it was taken from is worse than no print-out. Deliberately free of
 * "server-only" — both a server component and the print sheet import it.
 */
export const REGISTER_KIND_LABELS: Record<string, string> = {
  PURCHASE: "Purchase",
  SALE: "Sale",
  EXPENSE: "Expense",
  PAYMENT: "Payment",
  RECEIPT: "Receipt",
};

/** The row's second line: which kind of purchase, sale, expense or settlement. */
export function registerSubtypeLabel(kind: string, subtype: string): string {
  if (kind === "PAYMENT" || kind === "RECEIPT")
    return (
      SETTLEMENT_MODE_LABELS[subtype as keyof typeof SETTLEMENT_MODE_LABELS] ??
      subtype
    );
  if (kind === "PURCHASE")
    return (
      PURCHASE_TYPE_LABELS[subtype as keyof typeof PURCHASE_TYPE_LABELS] ??
      subtype
    );
  if (kind === "SALE")
    return (
      SALE_TYPE_LABELS[subtype as keyof typeof SALE_TYPE_LABELS] ?? subtype
    );
  // Expense subtypes are category CODES now. getTransactionRegister already
  // resolves the row, so the code arriving here is the fallback label — title
  // -cased so "OFFICE_RENT" reads as "Office Rent" rather than shouting.
  return subtype
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
