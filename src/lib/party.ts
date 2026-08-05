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
};

export const PARTY_TYPES = Object.keys(PARTY_TYPE_LABELS) as PartyType[];

/**
 * Name registries, not ledgers.
 *
 * A boat is *where the fish came from*, not *who the money is owed to* — the
 * business settles with Society, KFDC or the private owner, and which vessel
 * landed the catch is a detail on the line. Same for the "Name" on a Local
 * purchase. These are kept as Party rows purely so the name can be picked from
 * a list instead of retyped, and so a statement row can name the vessel.
 * Nothing ever posts a LedgerEntry against them, so listing them among the
 * ledgers only produced a screenful of permanently-zero balances.
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
 * The party type of the *boat or seller* named on a purchase. Society / KFDC /
 * Private name the individual BOAT; Local names the seller ("Name").
 *
 * Recorded on the purchase for display only — see RECORD_ONLY_PARTY_TYPES.
 */
export const PURCHASE_BOAT_TYPE: Record<PurchaseType, PartyType> = {
  SOCIETY: "BOAT",
  KFDC: "BOAT",
  PRIVATE: "BOAT",
  LOCAL: "LOCAL_SELLER",
};

/**
 * The ledger a purchase posts to, for the types where the type itself fixes it.
 *
 * Society is one counterparty and KFDC is another, however many boats each
 * sends; Local purchases are settled on the spot and roll up into one account.
 * PRIVATE is deliberately absent — there is no single private counterparty, so
 * the party is typed on the voucher and gets its own ledger (see
 * purchasePartyIsTyped). Money is owed to the party, never to the vessel.
 */
export const FIXED_PURCHASE_PARTY: Partial<Record<PurchaseType, string>> = {
  SOCIETY: "Society",
  KFDC: "KFDC",
  LOCAL: "Local Individuals",
};

/** True when the purchase form must ask for the party name (Private only). */
export function purchasePartyIsTyped(type: PurchaseType): boolean {
  return !FIXED_PURCHASE_PARTY[type];
}
