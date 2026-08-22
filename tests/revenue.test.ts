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
  it("market revenue is the net bill plus the rent deducted on it", () => {
    // The last market stop paid the driver ₹15,000 on BFM's behalf, so that
    // money left the business even though the party never handed it over.
    expect(
      saleRevenue({ type: "MARKET", amount: 100_000, rentDeducted: 15_000 })
    ).toBe(115_000);
  });

  it("a market bill that carried no rent recognises just the net", () => {
    // Only ONE bill per trip carries the rent — the others are plain nets.
    expect(saleRevenue({ type: "MARKET", amount: 60_000 })).toBe(60_000);
    expect(
      saleRevenue({ type: "MARKET", amount: 60_000, rentDeducted: null })
    ).toBe(60_000);
  });

  it("factory, fish mill and local revenue is the bill amount, full stop", () => {
    // These channels pay in full: BFM pays the driver on his return, so there
    // is never a rent deduction to gross back up.
    for (const type of ["FACTORY", "FISH_MILL", "LOCAL"] as const) {
      expect(saleRevenue({ type, amount: 70_000 })).toBe(70_000);
    }
  });

  it("ignores a rent deduction wrongly set on a non-market bill", () => {
    // Belt and braces: the action rejects deductions on non-market sales, but
    // if one ever slipped through it must not inflate revenue.
    expect(
      saleRevenue({ type: "FACTORY", amount: 70_000, rentDeducted: 8_000 })
    ).toBe(70_000);
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
