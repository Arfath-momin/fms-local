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

/**
 * The weight one sale line actually represents.
 *
 * On a Fish Mill bill `kgs` is the weight of a SINGLE box, not of the row: 100
 * kg packed into 10 boxes is 1,000 kg sold, and the money follows the 1,000.
 * This is the same rule delivery notes use (see lineTotalKg in src/lib/delivery
 * .ts), and for the same reason — the merchant weighs a box, not a consignment.
 *
 * A row with no boxes has nowhere to multiply, so its kgs counts once.
 * Multiplying by zero would erase the weight of anything sold loose, and Local
 * sales have no box column at all.
 *
 * Deliberately computed rather than stored: a `total_kg` column could drift
 * from the box and kg it was derived from, and there is no second source of
 * truth to reconcile it against.
 */
export function saleLineTotalKg(line: {
  qtyKg: number;
  box?: number | null;
}): number {
  return line.box && line.box > 0 ? line.qtyKg * line.box : line.qtyKg;
}
