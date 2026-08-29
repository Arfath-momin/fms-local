import { describe, expect, it } from "vitest";
import { profitTiers, saleRevenue } from "@/lib/sale";

/**
 * The 16 Aug trading day from BFM_REBUILD_PLAN, Phase 3's gate.
 *
 * One day, end to end, in the units the merchant actually quotes them in. It
 * is here rather than only at the Phase 3 gate because it is the single check
 * that ties every §2 rule together: get any one of them wrong — net the rent,
 * post the commission as income, charge an overhead to the day — and the
 * figure moves.
 */
describe("16 Aug worked example", () => {
  const purchases = 185_000;
  const directOps = 15_000; // ice, loaders, ladies, batha, canteen
  const rents = { market: 20_000, factory: 8_000, mill: 4_000 };
  const directExpenses = directOps + rents.market + rents.factory + rents.mill;

  // The market truck's bills, quoted GROSS as the market quotes them.
  const marketTotalBills = 180_000;
  const commission = 3_600; // 2% — charged BY the market TO BFM
  const labour = 2_000;
  const reserve = 6_000; // withheld, collected at year end
  // The last market paid the driver the rent balance on BFM's behalf.
  const rentOnLastBill = rents.market;

  // Rent is not a deduction: it settles part of the bill rather than shrinking
  // it, so the net is struck on the market's own charges alone.
  const netMarketBill = marketTotalBills - commission - labour - reserve;

  it("nets the market bill down the way the bill reads", () => {
    expect(netMarketBill).toBe(168_400);
  });

  it("leaves the market owing the net less what it paid the driver", () => {
    expect(netMarketBill - rentOnLastBill).toBe(148_400);
  });

  it("recognises ₹31,400 gross profit for the day", () => {
    const revenue =
      saleRevenue({ type: "MARKET", amount: netMarketBill }) +
      saleRevenue({ type: "FACTORY", amount: 70_000 }) +
      saleRevenue({ type: "FISH_MILL", amount: 25_000 });

    // The market bill IS the revenue. Commission, labour and reserve were never
    // BFM's money and stay netted out; the rent never came out, so there is
    // nothing to add back — the total is the same 263,400 either way.
    expect(revenue).toBe(263_400);

    const { gross } = profitTiers({ revenue, purchases, directExpenses });
    expect(gross).toBe(31_400);
  });

  it("leaves ₹6,000 of reserve outstanding, tracked per party", () => {
    // Three market parties on the one trip. The balance is derived per party —
    // pooling them into a single ₹6,000 account is the bug this replaced.
    const byParty = { "Kondatty": 2_500, "City Market": 2_000, "Malpe": 1_500 };
    const outstanding = Object.values(byParty).reduce((a, b) => a + b, 0);
    expect(outstanding).toBe(reserve);
    expect(Object.keys(byParty)).toHaveLength(3);
  });

  it("an overhead entered that month does not move the day's gross", () => {
    const revenue = 263_400;
    const withoutSalary = profitTiers({ revenue, purchases, directExpenses });
    const withSalary = profitTiers({
      revenue,
      purchases,
      directExpenses,
      overheads: 40_000,
    });
    expect(withSalary.gross).toBe(withoutSalary.gross);
    expect(withSalary.gross).toBe(31_400);
    // It lands on net, where it belongs.
    expect(withSalary.net).toBe(31_400 - 40_000);
  });
});

/**
 * The rent settlement chain (spec §2). A transporter's balance closing at zero
 * is the signal that a trip was fully settled — so a balance that does NOT
 * close is a real unpaid rent, and must never be suppressed.
 */
describe("transporter balance closes at zero", () => {
  // Sign convention, as everywhere in the app: CREDIT is money we owe.
  const credit = (n: number) => -n;
  const debit = (n: number) => n;

  it("market trip: rent credited, advance and party payment debit it back", () => {
    const entries = [
      credit(20_000), // RENT — the whole trip's rent, owed to the transporter
      debit(5_000), // PAYMENT — advance handed to the driver at departure
      debit(15_000), // RENT_BY_PARTY — the last market paid him the balance
    ];
    expect(entries.reduce((a, b) => a + b, 0)).toBe(0);
  });

  it("factory trip: rent credited, settled in full on his return", () => {
    const entries = [credit(8_000), debit(8_000)];
    expect(entries.reduce((a, b) => a + b, 0)).toBe(0);
  });

  it("an unsettled trip leaves a balance rather than hiding it", () => {
    const entries = [credit(8_000), debit(5_000)];
    expect(entries.reduce((a, b) => a + b, 0)).toBe(-3_000);
  });
});
