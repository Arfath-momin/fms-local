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

/**
 * The commission rate offered by default on a new Market sale, as a percentage.
 *
 * A DEFAULT, not the rate. It used to be the only rate there was — a hardcoded
 * 0.02 the action multiplied by — which meant a bill agreed at any other figure
 * could not be recorded at all. The clerk now types the rate per bill and this
 * only pre-fills the field, because 2% is still what most bills are struck at
 * and retyping it every time would be its own kind of error.
 *
 * Expressed as a percentage (2.5 means 2.5%) rather than a fraction, so the
 * number in the code, the number in the input and the number on the printed
 * bill are all the same number.
 */
export const DEFAULT_MARKET_COMMISSION_RATE = 2;

/** Rates outside this range are a typo — 200% commission, or a negative one. */
export const MAX_COMMISSION_RATE = 100;

/**
 * Commission in rupees for a bill, at a given percentage rate.
 *
 * Shared by the form (which previews it live) and the action (which stores the
 * result), so what the clerk is shown before saving and what lands in the
 * database can never be computed two different ways.
 */
export function commissionAmount(totalBill: number, ratePercent: number): number {
  if (!(totalBill > 0) || !(ratePercent > 0)) return 0;
  return (totalBill * ratePercent) / 100;
}

/**
 * The balancing item on a market bill — labour and the sundries nobody itemises.
 *
 *     total − commission − cutting − reserve − net = labour / other
 *
 * DERIVED, because everything else on the bill is either typed off the market's
 * paper or struck as a percentage of the total, and what is left between the
 * total and the net they actually paid is by definition what those sundry
 * charges came to. Asking a clerk to type it as well would give the bill two
 * figures that can disagree.
 *
 * Rent is deliberately absent. What a market handed the driver settles part of
 * this bill rather than shrinking it — subtracting it here would understate the
 * bill by exactly the amount the receipt then credits, and the market would end
 * up owing 15,000 less than it does.
 *
 * Negative means the named deductions and the net come to more than the total,
 * which is a bill that does not add up. The caller decides what to do about it:
 * the form shows it in red while typing, the action refuses to save it.
 *
 * Pure and shared, so the figure the clerk approves and the figure stored are
 * never two calculations — the same reason commissionAmount above is shared.
 */
export function marketOtherDeduction(bill: {
  totalBill: number;
  commission: number;
  cutting: number;
  reserve: number;
  netBill: number;
}): number {
  return (
    bill.totalBill -
    bill.commission -
    bill.cutting -
    bill.reserve -
    bill.netBill
  );
}

/**
 * The weight one sale line represents.
 *
 * Now simply what was entered. `qtyKg` used to be the weight of a SINGLE box,
 * multiplied up by the box count — but the merchant does not weigh boxes. A lot
 * goes on the scale whole: 150 boxes, 4,500 kg. Asking for a per-box figure
 * made the clerk divide before they could type, and a rounded average moved the
 * money — 4,400 over 150 boxes is 29.333, which multiplies back to 4,399.95.
 *
 * The per-box figure is the average, and it falls out of the two numbers that
 * were actually observed (see saleLineKgPerBox). Delivery notes already worked
 * this way; sale lines now agree with them, so one column means one thing on
 * both documents.
 *
 * Kept as a function rather than inlined so every caller reading a line's
 * weight goes through one place if the rule ever moves again.
 */
export function saleLineTotalKg(line: {
  qtyKg: number;
  box?: number | null;
}): number {
  return line.qtyKg;
}

/**
 * The average weight of one box on this line — derived, never entered.
 *
 * Zero when the line carries no boxes: a market row counted only in boxes has
 * no weight to average, and a loose row has no boxes to divide by.
 */
export function saleLineKgPerBox(line: {
  qtyKg: number;
  box?: number | null;
}): number {
  if (!line.box || line.box <= 0) return 0;
  return line.qtyKg / line.box;
}

/**
 * Revenue recognised for one bill (spec §2) — the bill amount, whatever the
 * channel.
 *
 * This used to gross a market bill back up by the rent deducted on it, and the
 * reason is worth recording now that it is gone. A market bill read
 *
 *     total − commission − cutting − reserve − labour − RENT = net
 *
 * so a market that paid the driver 15,000 was billed 15,000 less, and revenue
 * had to add the 15,000 back or the day would carry a cost it was never
 * credited for. Two steps in opposite directions to arrive where it started.
 *
 * Rent is no longer deducted from the net at all. The market owes the whole
 * net; paying the driver is a RECEIPT against it (see the Sale model's
 * rentDeducted). So the amount is already the full revenue and there is nothing
 * to gross up — the deduction that made this function necessary no longer
 * happens.
 *
 * Pure and total: no database, no Decimal, so the money tests can call it
 * directly and the arithmetic is checkable in isolation.
 */
export function saleRevenue(sale: {
  type: SaleType;
  /** The net bill for MARKET; the bill amount otherwise. */
  amount: number;
}): number {
  return sale.amount;
}

/**
 * The two profit tiers (spec §2).
 *
 *   gross = revenue − purchases − DIRECT expenses      per buying day
 *   net   = gross − overheads + reserve collected      per month
 *
 * Overheads never touch gross. A salary is not a cost of Tuesday's catch, and
 * charging it there makes the daily figure — the one the merchant actually
 * reads every morning — meaningless.
 */
export function profitTiers(f: {
  revenue: number;
  purchases: number;
  directExpenses: number;
  overheads?: number;
  reserveCollected?: number;
}): { gross: number; net: number } {
  const gross = f.revenue - f.purchases - f.directExpenses;
  return {
    gross,
    net: gross - (f.overheads ?? 0) + (f.reserveCollected ?? 0),
  };
}
