import type {
  DeliveryChannel,
  PartyType,
  PurchaseType,
} from "@/generated/prisma/enums";

export const PARTY_TYPE_LABELS: Record<PartyType, string> = {
  SOCIETY: "Society",
  PRIVATE_SELLER: "Private Seller",
  BOAT: "Boat",
  MARKET_BUYER: "Market Buyer",
  FACTORY: "Factory",
  FISH_MILL: "Fish Mill",
  LOCAL_BUYER: "Local Buyer",
};

export const PARTY_TYPE_PLURALS: Record<PartyType, string> = {
  SOCIETY: "Societies",
  PRIVATE_SELLER: "Private Sellers",
  BOAT: "Boats",
  MARKET_BUYER: "Market Buyers",
  FACTORY: "Factories",
  FISH_MILL: "Fish Mills",
  LOCAL_BUYER: "Local Buyers",
};

export const PARTY_TYPES = Object.keys(PARTY_TYPE_LABELS) as PartyType[];

/**
 * Which party types can SELL to us, per purchase type. Buyer-side parties
 * (market buyers, factories, mills) never appear on a purchase.
 */
export const PURCHASE_SELLER_TYPES: Record<PurchaseType, PartyType[]> = {
  SOCIETY: ["SOCIETY"],
  PRIVATE: ["PRIVATE_SELLER", "BOAT"],
  LOCAL: ["PRIVATE_SELLER", "BOAT"],
};

/**
 * Which party type BUYS through each delivery channel. The delivery-note
 * buyer list shows only the matching type.
 */
export const CHANNEL_BUYER_TYPE: Record<DeliveryChannel, PartyType> = {
  FACTORY: "FACTORY",
  MARKET: "MARKET_BUYER",
  FISH_MILL: "FISH_MILL",
  LOCAL_SALE: "LOCAL_BUYER",
};

/** Direct sales are the local quick path — local buyers only. */
export const DIRECT_SALE_BUYER_TYPES: PartyType[] = ["LOCAL_BUYER"];
