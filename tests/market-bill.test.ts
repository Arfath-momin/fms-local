import { describe, expect, it } from "vitest";
import { commissionAmount, marketOtherDeduction, saleRevenue } from "@/lib/sale";

/**
 * The market bill's working, with cutting in it.
 *
 * A market takes several things off before it hands over the net:
 *
 *     total bill      78,300
 *     less commission  8,613   struck as a % of the total
 *     less cutting     1,174.50  struck as a % of the total, withheld
 *     less reserve     5,000   a figure they name, withheld
 *     less labour      4,892.50  the balancing item
 *     ─────────────────────────
 *     net bill        58,620
 *
 * Commission is a COST charged to BFM (spec invariant 4). Cutting and reserve
 * are BFM's own money the market is holding and will hand over later — they
 * reduce profit now and become income when collected (invariant 5). All four
 * stay netted inside the net bill and none of them posts anywhere.
 */
const TOTAL = 78_300;
const COMMISSION_RATE = 11;
const CUTTING_RATE = 1.5;
const RESERVE = 5_000;
const NET = 58_620;

describe("the market bill's working", () => {
  it("strikes cutting off the total, the way commission is struck", () => {
    expect(commissionAmount(TOTAL, CUTTING_RATE)).toBe(1_174.5);
    expect(commissionAmount(TOTAL, COMMISSION_RATE)).toBe(8_613);
  });

  it("derives labour as whatever is left over", () => {
    const other = marketOtherDeduction({
      totalBill: TOTAL,
      commission: commissionAmount(TOTAL, COMMISSION_RATE),
      cutting: commissionAmount(TOTAL, CUTTING_RATE),
      reserve: RESERVE,
      netBill: NET,
    });
    expect(other).toBe(4_892.5);
    // Which is exactly what makes the bill add up.
    expect(
      TOTAL -
        commissionAmount(TOTAL, COMMISSION_RATE) -
        commissionAmount(TOTAL, CUTTING_RATE) -
        RESERVE -
        other
    ).toBe(NET);
  });

  it("goes negative when the deductions overshoot the total", () => {
    // A bill that does not add up. The form shows this in red while typing and
    // the action refuses to save it, rather than storing a negative charge.
    expect(
      marketOtherDeduction({
        totalBill: 10_000,
        commission: 500,
        cutting: 200,
        reserve: 1_000,
        netBill: 9_000,
      })
    ).toBe(-700);
  });

  it("leaves the rent out of the working entirely", () => {
    // Rent used to be one of the deductions, so a market that paid the driver
    // 15,000 was billed 15,000 less. Including it here would understate the
    // bill by exactly what the receipt then credits, and the market would end
    // up owing 15,000 less than it really does.
    const withRent = marketOtherDeduction({
      totalBill: 45_000,
      commission: 900,
      cutting: 0,
      reserve: 1_500,
      netBill: 42_100,
    });
    expect(withRent).toBe(500);
    // The net is the whole 42,100 whatever the market handed the driver.
    expect(saleRevenue({ type: "MARKET", amount: 42_100 })).toBe(42_100);
  });

  it("treats cutting and reserve identically in the profit they defer", () => {
    // Both are BFM's rupees sitting with the market. Withheld they reduce the
    // day; collected they lift net profit. Nothing about the arithmetic tells
    // them apart — only the name the trade gives them, and the party balance
    // each is chased on.
    const cutting = commissionAmount(TOTAL, CUTTING_RATE);
    const swapped = marketOtherDeduction({
      totalBill: TOTAL,
      commission: commissionAmount(TOTAL, COMMISSION_RATE),
      cutting: RESERVE,
      reserve: cutting,
      netBill: NET,
    });
    expect(swapped).toBe(4_892.5);
  });
});
