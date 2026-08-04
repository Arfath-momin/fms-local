// Pure constants and labels — no database, no filesystem, no session. This
// module is deliberately NOT marked `server-only`: the sale form is a Client
// Component and needs the same buyer-type map and commission rate the server
// action validates against. Marking it server-only forced the form to keep its
// own copies, which is exactly how the two drift apart.
import type { PartyType, SaleType } from "@/generated/prisma/enums";

export const SALE_TYPES: SaleType[] = ["MARKET", "FISH_MILL", "FACTORY", "LOCAL"];

export const SALE_TYPE_LABELS: Record<SaleType, string> = {
  MARKET: "Market",
  FISH_MILL: "Fish Mill",
  FACTORY: "Factory",
  LOCAL: "Local",
};

/** Which party type is the buyer on each sale type. */
export const SALE_BUYER_TYPE: Record<SaleType, PartyType> = {
  MARKET: "MARKET_BUYER", // the market "Seller Name" — they owe us the net bill
  FISH_MILL: "FISH_MILL",
  FACTORY: "FACTORY",
  LOCAL: "LOCAL_BUYER",
};

/** CareOf routing is only offered on Fish Mill and Factory sales. */
export const SALE_TYPE_ALLOWS_CARE_OF: Record<SaleType, boolean> = {
  MARKET: false,
  FISH_MILL: true,
  FACTORY: true,
  LOCAL: false,
};

/** Market commission rate — 2% of Total Bill, shown for reference only. */
export const MARKET_COMMISSION_RATE = 0.02;
