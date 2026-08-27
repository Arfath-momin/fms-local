// Categories are rows in `expense_categories` now, not an enum — the merchant
// owns the list, and each row carries the DIRECT / OVERHEAD kind that decides
// which profit tier it lands in (spec §3.4).
//
// What could NOT move into the database is the *entry shape*: ice is blocks ×
// rate per block, loaders is boxes × rate per box, canteen is a flat total.
// Those are form layouts, which is code. So the specs below are keyed by the
// category's stable `code`, and a category whose code has no spec here simply
// gets the plain amount field — which is what makes adding "Electricity" from
// Masters work without a deploy.

/** Codes every company starts with. Others are user-created and are fine. */
export const DIRECT_CODES = [
  "ICE",
  "LOADERS",
  "LADIES",
  "BATHA",
  "CANTEEN",
  "RENT",
] as const;
export const OVERHEAD_CODES = ["SALARY", "OFFICE_RENT", "OTHER"] as const;

/**
 * The heads every company gets on the day it is created.
 *
 * These used to exist only inside scripts/seed.ts, which meant a real company —
 * created from the Companies screen, or by bootstrap on a fresh server — began
 * with an empty list and could not record a single expense until someone went
 * to Masters and typed all nine in. Worse, RENT is not optional: recording a
 * trip's rent looks it up by code and fails outright without it, so a brand new
 * company could raise a delivery note and then be unable to close it.
 *
 * The DIRECT / OVERHEAD split is the whole point of the list and not a
 * preference — only DIRECT costs reach a buying day's gross profit (spec §3.4).
 *
 * The merchant still owns the list: anything here can be archived if they never
 * use it, and anything else can be added from Masters. This is the starting
 * point, not a fixed set.
 */
export const DEFAULT_EXPENSE_CATEGORIES: readonly {
  code: string;
  name: string;
  kind: "DIRECT" | "OVERHEAD";
  /** OTHER shows a description/amount line table instead of one flat figure. */
  allowsLines: boolean;
}[] = [
  { code: "ICE", name: "Ice", kind: "DIRECT", allowsLines: false },
  { code: "LOADERS", name: "Loaders", kind: "DIRECT", allowsLines: false },
  { code: "LADIES", name: "Ladies", kind: "DIRECT", allowsLines: false },
  { code: "BATHA", name: "Batha", kind: "DIRECT", allowsLines: false },
  { code: "CANTEEN", name: "Canteen", kind: "DIRECT", allowsLines: false },
  { code: "RENT", name: "Vehicle Rent", kind: "DIRECT", allowsLines: false },
  { code: "SALARY", name: "Salaries", kind: "OVERHEAD", allowsLines: false },
  { code: "OFFICE_RENT", name: "Office Rent", kind: "OVERHEAD", allowsLines: false },
  { code: "OTHER", name: "Other", kind: "OVERHEAD", allowsLines: true },
];

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
  /**
   * What KIND of party that vendor is. Defaults to EXPENSE_VENDOR, which is
   * right for an ice plant or a canteen. Vehicle rent is the exception: the
   * money is owed to a TRANSPORTER, and filing him as an expense vendor would
   * split one man's account in two — the rent on one ledger, the trips he ran
   * on another.
   */
  vendorType?: "EXPENSE_VENDOR" | "TRANSPORTER";
  /**
   * Detail keys holding money already handed over against this total.
   *
   * Vehicle rent is agreed as one figure but rarely paid as one: an advance
   * goes to the driver before he leaves, more may be settled from what he
   * collects on the way, and only the remainder is still owed. Each of these
   * posts a DEBIT alongside the total's CREDIT, so the vendor's outstanding
   * balance *is* the balance still to pay — no second field storing a figure
   * that could disagree with the ledger.
   */
  prepaidFrom?: string[];
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
export const EXPENSE_SPECS: Record<string, ExpenseCategorySpec> = {
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
  // Vehicle rent is an ordinary expense voucher again.
  //
  // It was moved onto the trip — recorded from the delivery note, or carried on
  // whichever market bill happened to be the last stop — on the reasoning that
  // a hand-entered voucher would be a second expense. In practice that got the
  // business backwards. A rent is agreed when the truck is LOADED, before
  // anybody knows what it will sell for or how many places it will stop; and
  // one journey can end in a factory bill for the load and a market bill for
  // the returns, which made "which bill carries the rent" a question with no
  // natural answer. The clerk had to know the whole route before entering a
  // cost they had already agreed.
  //
  // So: one voucher, entered at loading, for every channel. The advance and
  // anything a market handed the driver are SETTLEMENTS against it — each
  // posts a DEBIT beside the total's CREDIT, so what the transporter is still
  // owed is the ledger balance itself and never a second stored figure.
  // Invariant 2 holds exactly as before: expensed once, dated to the buying
  // day. It is simply entered where the merchant already knows it.
  RENT: {
    label: "Vehicle Rent",
    fields: [
      t("vehicleNo", "Vehicle No"),
      t("transporter", "Transporter / Vehicle Owner"),
      n("advance", "Advance Paid at Loading", false),
      n("paidByMarket", "Paid to Driver by Market", false),
    ],
    amountEntered: true,
    vendorFrom: "transporter",
    vendorType: "TRANSPORTER",
    prepaidFrom: ["advance", "paidByMarket"],
  },
};

/**
 * How much of an expense total has already been handed over, from the detail
 * fields named by `prepaidFrom`. Zero for every category that has none.
 */
export function expensePrepaid(
  code: string,
  details: Record<string, string>
): number {
  const keys = EXPENSE_SPECS[code]?.prepaidFrom;
  if (!keys) return 0;
  return keys.reduce((sum, k) => sum + (Number(details[k]) || 0), 0);
}

/** Ledger/party name for an expense — the vendor field where given, else the category. */
export function expenseVendorName(
  code: string,
  categoryName: string,
  details: Record<string, string>
): string {
  const spec = EXPENSE_SPECS[code];
  const v = spec?.vendorFrom ? details[spec.vendorFrom]?.trim() : "";
  // Falls back to the category's own name from the database rather than a
  // hardcoded label, so a user-created category still names its ledger.
  return v || spec?.label || categoryName;
}
