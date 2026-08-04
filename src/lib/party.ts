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
  PURCHASE_GROUP: "Purchase Group",
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
  PURCHASE_GROUP: "Purchase Groups",
  COMMISSION: "Commission Account",
};

export const PARTY_TYPES = Object.keys(PARTY_TYPE_LABELS) as PartyType[];

/**
 * The party type of the *boat or seller* named on a purchase. Society / KFDC /
 * Private identify the individual BOAT; Local identifies the seller ("Name").
 *
 * This is recorded on the purchase for display only. It is deliberately NOT
 * the ledger — see PURCHASE_GROUP_NAME.
 */
export const PURCHASE_SELLER_TYPE: Record<PurchaseType, PartyType> = {
  SOCIETY: "BOAT",
  KFDC: "BOAT",
  PRIVATE: "BOAT",
  LOCAL: "LOCAL_SELLER",
};

/**
 * The ledger a purchase actually posts to.
 *
 * Money is owed to the group, not to the vessel: the business settles with
 * Society, and which of Society's boats brought the fish is a detail on the
 * line. Giving every boat its own ledger — which is what this used to do —
 * produced dozens of tiny statements and no Society balance at all.
 */
export const PURCHASE_GROUP_NAME: Record<PurchaseType, string> = {
  SOCIETY: "Society",
  KFDC: "KFDC",
  PRIVATE: "Private Parties",
  LOCAL: "Local Individuals",
};

export const PURCHASE_GROUP_NAMES = Object.values(PURCHASE_GROUP_NAME);

