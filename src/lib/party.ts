import type { PartyType } from "@/generated/prisma/enums";

export const PARTY_TYPE_LABELS: Record<PartyType, string> = {
  SOCIETY: "Society",
  PRIVATE_SELLER: "Private Seller",
  BOAT: "Boat",
  MARKET_BUYER: "Market Buyer",
  FACTORY: "Factory",
  FISH_MILL: "Fish Mill",
  LOCAL_BUYER: "Local Buyer",
};

export const PARTY_TYPES = Object.keys(PARTY_TYPE_LABELS) as PartyType[];
