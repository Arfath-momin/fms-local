import type { PartyType, PurchaseType } from "@/generated/prisma/enums";

export const PARTY_TYPE_LABELS: Record<PartyType, string> = {
  BOAT: "Boat",
  LOCAL_SELLER: "Local Seller",
  MARKET_BUYER: "Market Buyer",
  FACTORY: "Factory",
  FISH_MILL: "Fish Mill",
  LOCAL_BUYER: "Local Buyer",
  EXPENSE_VENDOR: "Expense Vendor",
  CARE_OF: "CareOf",
  PURCHASE_GROUP: "Purchase Party",
  COMMISSION: "Commission",
  RESERVE: "Reserve",
};

export const PARTY_TYPE_PLURALS: Record<PartyType, string> = {
  BOAT: "Boats",
  LOCAL_SELLER: "Local Sellers",
  MARKET_BUYER: "Market Buyers",
  FACTORY: "Factories",
  FISH_MILL: "Fish Mills",
  LOCAL_BUYER: "Local Buyers",
  EXPENSE_VENDOR: "Expense Vendors",
  CARE_OF: "CareOf Agents",
  PURCHASE_GROUP: "Purchase Parties",
  COMMISSION: "Commission Account",
  RESERVE: "Reserve Account",
};

export const PARTY_TYPES = Object.keys(PARTY_TYPE_LABELS) as PartyType[];

/**
 * Name registries, not ledgers.
 *
 * A boat is *where the fish came from*, not *who the money is owed to* — the
 * business settles with Society or KFDC, and which vessel landed the catch is a
 * detail on the line. Boats are kept as Party rows purely so the name can be
 * picked from a list instead of retyped, and so a statement row can name the
 * vessel. Nothing ever posts a LedgerEntry against them, so listing them among
 * the ledgers only produced a screenful of permanently-zero balances.
 *
 * LOCAL_SELLER is here for the same reason it always was, but it is now a dead
 * type: a Local seller is a real counterparty and gets a PURCHASE_GROUP ledger
 * of their own (see FIXED_PURCHASE_PARTY). Only rows written before that change
 * still carry the type, and they never had entries either.
 */
export const RECORD_ONLY_PARTY_TYPES: PartyType[] = ["BOAT", "LOCAL_SELLER"];

export function isLedgerPartyType(type: PartyType): boolean {
  return !RECORD_ONLY_PARTY_TYPES.includes(type);
}

export const LEDGER_PARTY_TYPES = PARTY_TYPES.filter(isLedgerPartyType);

/**
 * How the Ledgers menu is partitioned. A flat alphabetical list of every party
 * mixed suppliers, buyers and vendors together and was unreadable; each section
 * below answers one question ("who do we owe", "what did we spend", "who owes
 * us") and is reached by its own menu entry.
 */
export const PURCHASE_LEDGER_TYPES: PartyType[] = ["PURCHASE_GROUP"];

export const EXPENSE_LEDGER_TYPES: PartyType[] = ["EXPENSE_VENDOR"];

export const SALE_LEDGER_TYPES: PartyType[] = [
  "MARKET_BUYER",
  "FISH_MILL",
  "FACTORY",
  "LOCAL_BUYER",
  "CARE_OF",
];

/** Where a party's statement belongs — drives the back-link on every statement. */
export function ledgerSectionFor(type: PartyType): {
  href: string;
  label: string;
} {
  if (PURCHASE_LEDGER_TYPES.includes(type))
    return { href: "/ledgers/purchase-parties", label: "Purchase Parties" };
  if (EXPENSE_LEDGER_TYPES.includes(type))
    return { href: "/ledgers/expenses", label: "Expense Ledgers" };
  if (SALE_LEDGER_TYPES.includes(type))
    return { href: "/ledgers/sales", label: "Sale Ledgers" };
  return { href: "/ledgers/parties", label: "All Ledgers" };
}

/**
 * The ledger a purchase posts to, for the types where the type itself fixes it.
 *
 * Society is one counterparty and KFDC is another, however many boats each
 * sends. PRIVATE and LOCAL are deliberately absent: there is no single private
 * or local counterparty, so the seller is named on the voucher and gets a
 * ledger of their own (see purchasePartyIsTyped).
 *
 * LOCAL used to map to one shared "Local Individuals" account. That was wrong —
 * if Ravi sells us ₹40,000 of fish and Raju sells us ₹50,000, we owe Ravi
 * ₹40,000 and Raju ₹50,000, not ₹90,000 to a group that cannot be paid. The
 * seller's name was already being captured; it just had nowhere to post.
 */
export const FIXED_PURCHASE_PARTY: Partial<Record<PurchaseType, string>> = {
  SOCIETY: "Society",
  KFDC: "KFDC",
};

/**
 * True when the purchase form must ask who the money is owed to — Private and
 * Local, the two types that buy from a different individual each time.
 */
export function purchasePartyIsTyped(type: PurchaseType): boolean {
  return !FIXED_PURCHASE_PARTY[type];
}

/**
 * True when each line of the bill names its own boat.
 *
 * A Society or KFDC bill covers whatever vessels landed that day, so the boat
 * belongs on the line, not in the header. Private and Local bills are one
 * seller's own catch — the seller is the purchase's party, and there is no
 * separate vessel to record.
 */
export function purchaseHasLineBoats(type: PurchaseType): boolean {
  return !purchasePartyIsTyped(type);
}
