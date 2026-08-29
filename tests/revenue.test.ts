import { describe, expect, it } from "vitest";
import { profitTiers, saleRevenue } from "@/lib/sale";

/**
 * The revenue rules from BFM_DOMAIN_SPEC §2.
 *
 * These exist because the arithmetic they cover is the thing a later phase can
 * silently break: every one of them was wrong in the codebase at some point,
 * and nothing failed when it was.
 */
describe("revenue recognition", () => {
  it("revenue is the bill amount on every channel, market included", () => {
    for (const type of ["MARKET", "FACTORY", "FISH_MILL", "LOCAL"] as const) {
      expect(saleRevenue({ type, amount: 70_000 })).toBe(70_000);
    }
  });

  it("does not gross a market bill up by the rent the market paid", () => {
    // This is the regression that matters. Market revenue USED to be
    // `net + rentDeducted`, because the net was struck after deducting what the
    // market handed the driver. Rent is no longer deducted from the net — the
    // bill is the whole net and the payment is a receipt against it — so adding
    // it back now would count the same 15,000 twice.
    //
    // The bill below is one where a market paid the driver 15,000: total 45,000
    // less commission 900, reserve 1,500 and labour 500 comes to 42,100, and
    // 42,100 is what the day earned. Not 57,100.
    expect(saleRevenue({ type: "MARKET", amount: 42_100 })).toBe(42_100);
  });
});

describe("profit tiers", () => {
  it("gross profit excludes overheads entirely", () => {
    const { gross, net } = profitTiers({
      revenue: 100_000,
      purchases: 60_000,
      directExpenses: 10_000,
      overheads: 25_000,
    });
    // A salary is not a cost of this catch. Gross must not see it.
    expect(gross).toBe(30_000);
    expect(net).toBe(5_000);
  });

  it("reserve collected lifts net profit, never gross", () => {
    const base = { revenue: 100_000, purchases: 60_000, directExpenses: 10_000 };
    const without = profitTiers(base);
    const with_ = profitTiers({ ...base, reserveCollected: 6_000 });
    expect(with_.gross).toBe(without.gross);
    expect(with_.net).toBe(without.net + 6_000);
  });
});
