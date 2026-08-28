import {
  EXPENSE_SPECS,
  type ExpenseCategorySpec,
} from "@/lib/expense";

/**
 * The rules for turning a filled-in expense into an amount, shared by every
 * place that fills one in.
 *
 * There are two now: the Expenses voucher, and the drawer on a sale bill where
 * the merchant records what a trip cost while the paper is still in their hand.
 * The MARKUP of those two is deliberately not shared — one is a page and one is
 * a drawer, and forcing them into a single component would make both worse. The
 * ARITHMETIC is shared, because two copies of "ice is blocks × rate per block"
 * is exactly the pair that drifts, and the day they disagree the ledger is
 * wrong and nothing says so.
 *
 * Deliberately free of `server-only`: the drawer previews the total live while
 * the merchant types, and the server recomputes it from the same function
 * rather than trusting what was posted.
 */

/** A category as both entry points know it. */
export type ExpenseCategoryLike = {
  code: string;
  name: string;
  allowsLines: boolean;
};

/**
 * The entry shape for a category.
 *
 * A category with no spec is one the merchant added from Masters — a plain
 * amount and no bespoke fields. That fallback is what lets them add
 * "Electricity" without a deploy.
 */
export function specFor(category: ExpenseCategoryLike): ExpenseCategorySpec {
  return (
    EXPENSE_SPECS[category.code] ?? {
      label: category.name,
      fields: [],
      amountEntered: true,
    }
  );
}

export type ExpenseLineInput = { description: string; amount: string };

const NUMBER = /^\d+(\.\d+)?$/;
const DECIMAL2 = /^\d+(\.\d{1,2})?$/;

/**
 * Validate a filled-in expense and work out what it comes to.
 *
 * Returns the amount as a STRING rather than a Decimal so the client can call
 * it too; the server wraps the result in a Decimal, which is the only place
 * money arithmetic happens.
 */
export function expenseEntryAmount(
  category: ExpenseCategoryLike,
  details: Record<string, string>,
  typedAmount: string,
  lines: ExpenseLineInput[] = []
): { error: string } | { amount: string } {
  const spec = specFor(category);

  for (const f of spec.fields) {
    const raw = (details[f.name] ?? "").trim();
    if (f.required && !raw) return { error: `${f.label} is required.` };
    if (raw && f.kind === "number" && (!NUMBER.test(raw) || Number(raw) <= 0))
      return { error: `${f.label} must be a positive number.` };
  }

  // An itemised category sums its rows into one figure — the single amount
  // every report reads, so no report has to know a voucher was itemised.
  if (category.allowsLines) {
    let total = 0;
    let counted = 0;
    for (const [i, l] of lines.entries()) {
      const description = l.description.trim();
      const raw = l.amount.trim();
      // A wholly blank row is the empty one at the bottom, not an error.
      if (!description && !raw) continue;
      if (!description)
        return { error: `Row ${i + 1} has an amount but no description.` };
      if (!DECIMAL2.test(raw) || Number(raw) <= 0)
        return { error: `Row ${i + 1} needs a positive amount.` };
      total += Number(raw);
      counted++;
    }
    if (counted === 0) return { error: `Add at least one ${category.name} item.` };
    return { amount: total.toFixed(2) };
  }

  if (spec.amountEntered) {
    const raw = typedAmount.trim();
    if (!DECIMAL2.test(raw) || Number(raw) <= 0)
      return { error: `${category.name} needs a positive total.` };
    return { amount: raw };
  }

  if (spec.totalFrom) {
    const [q, r] = spec.totalFrom;
    const qty = Number(details[q]);
    const rate = Number(details[r]);
    if (!(qty > 0) || !(rate > 0))
      return { error: `${category.name} needs both figures to work out a total.` };
    return { amount: (qty * rate).toFixed(2) };
  }

  if (spec.totalField) {
    const raw = (details[spec.totalField] ?? "").trim();
    if (!DECIMAL2.test(raw) || Number(raw) <= 0)
      return { error: `${category.name} needs a positive total.` };
    return { amount: raw };
  }

  return { error: `${category.name} has no total configured.` };
}

/**
 * The vendor a filled-in expense is owed to, or "" when nobody is.
 *
 * Optional on purpose, matching the Expense model: a canteen bill or a batha
 * has nobody to owe, and forcing a name would fill the party master with junk
 * nobody settles against.
 */
export function expenseEntryVendor(
  category: ExpenseCategoryLike,
  details: Record<string, string>
): string {
  const spec = specFor(category);
  if (!spec.vendorFrom) return "";
  return (details[spec.vendorFrom] ?? "").trim();
}
