import type {
  LedgerEntryType,
  LedgerSourceType,
  PartyType,
  SettlementKind,
  SettlementMode,
} from "@/generated/prisma/enums";

export const SETTLEMENT_KINDS: SettlementKind[] = ["PAYMENT", "RECEIPT"];

export const SETTLEMENT_KIND_LABELS: Record<SettlementKind, string> = {
  PAYMENT: "Payment",
  RECEIPT: "Receipt",
};

export const SETTLEMENT_KIND_PLURALS: Record<SettlementKind, string> = {
  PAYMENT: "Payments",
  RECEIPT: "Receipts",
};

/** What the voucher means in plain terms, shown under each form's heading. */
export const SETTLEMENT_KIND_BLURBS: Record<SettlementKind, string> = {
  PAYMENT:
    "Money paid out to a supplier — reduces what we owe them. Recorded separately from the purchase it settles.",
  RECEIPT:
    "Money collected from a customer — reduces what they owe us. Recorded separately from the sale it settles.",
};

export const SETTLEMENT_MODES: SettlementMode[] = [
  "CASH",
  "BANK",
  "UPI",
  "CHEQUE",
];

export const SETTLEMENT_MODE_LABELS: Record<SettlementMode, string> = {
  CASH: "Cash",
  BANK: "Bank",
  UPI: "UPI",
  CHEQUE: "Cheque",
};

/**
 * The ledger side each kind posts.
 *
 * Sign convention (see src/lib/ledger.ts): positive = the party owes us.
 * A purchase CREDITs the supplier, pushing their balance negative because we
 * owe them, so paying them DEBITs it back toward zero. A sale DEBITs the
 * customer, so collecting from them CREDITs it back toward zero.
 */
export const SETTLEMENT_LEDGER_TYPE: Record<SettlementKind, LedgerEntryType> = {
  PAYMENT: "DEBIT",
  RECEIPT: "CREDIT",
};

export const SETTLEMENT_SOURCE_TYPE: Record<SettlementKind, LedgerSourceType> = {
  PAYMENT: "PAYMENT",
  RECEIPT: "RECEIPT",
};

/** URL segment each kind lives under. */
export const SETTLEMENT_PATH: Record<SettlementKind, string> = {
  PAYMENT: "/vouchers/payments",
  RECEIPT: "/vouchers/receipts",
};

/**
 * Party types worth offering for each kind. A payment goes to someone we buy
 * from; a receipt comes from someone we sell to. Not enforced — the ledger
 * works for any party — but it keeps the picker short and the common case
 * one keystroke away.
 */
export const SETTLEMENT_PARTY_TYPES: Record<SettlementKind, PartyType[]> = {
  // Purchases are owed to the group (Society, KFDC, …), not to the individual
  // boat, so that is what a payment settles. Offering boats here would build a
  // balance on a ledger no purchase ever posts to.
  PAYMENT: ["PURCHASE_GROUP", "EXPENSE_VENDOR"],
  RECEIPT: ["MARKET_BUYER", "FACTORY", "FISH_MILL", "LOCAL_BUYER", "CARE_OF"],
};

export function isSettlementKind(v: unknown): v is SettlementKind {
  return v === "PAYMENT" || v === "RECEIPT";
}

/**
 * The single house account every Market sale's commission is posted to.
 *
 * No longer named for a rate. The rate is per-sale now (see the Sale model's
 * commissionRate), so "Commission (2%)" would have been a standing account
 * lying about every bill struck at anything else. The migration
 * 20260818000000_notes_commission_rate_reserve renames the existing row in
 * place, so the historic ledger follows rather than being orphaned.
 */
export const COMMISSION_PARTY_NAME = "Commission";

/**
 * The house account a Market sale's reserve is held in.
 *
 * Deliberately a second account rather than a second column on the commission
 * one. Commission is the house's income; reserve is the seller's own money
 * being held back. Summing them would produce a figure that means nothing —
 * so they are two statements, shown side by side because they are the two
 * things withheld from the same bill.
 */
export const RESERVE_PARTY_NAME = "Reserve";
