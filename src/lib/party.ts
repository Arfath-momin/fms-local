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
};

export const PARTY_TYPES = Object.keys(PARTY_TYPE_LABELS) as PartyType[];

/**
 * The seller side of a purchase is always identified by a typed name:
 * Society / KFDC / Private track the individual BOAT; Local tracks the seller
 * ("Name"). The name is resolved to a Party (find-or-create) so each gets its
 * own auto-built ledger.
 */
export const PURCHASE_SELLER_TYPE: Record<PurchaseType, PartyType> = {
  SOCIETY: "BOAT",
  KFDC: "BOAT",
  PRIVATE: "BOAT",
  LOCAL: "LOCAL_SELLER",
};

