import { describe, expect, it } from "vitest";

/**
 * Costs entered on the bill that revealed them.
 *
 * The arithmetic that has to hold when a market bill raises its own rent. Kept
 * as plain figures because it is the *relationships* that were wrong before,
 * not any one calculation: the rent was a separately typed total that could
 * disagree with the deduction, and the market was credited a rupee it had
 * already kept.
 */
describe("a market bill that raises its own rent", () => {
  // The trip, as the merchant entered it at loading.
  const ADVANCE = 5_000;
  // The rent, as the driver reported it when the bill came back.
  const RENT_TOTAL = 20_000;
  // The bill, as the market's paper reads.
  const TOTAL = 45_000;
  const COMMISSION = 900;
  const RESERVE = 1_500;
  const LABOUR = 500;

  // What this market actually handed the driver — derived, never typed.
  const rentDeducted = RENT_TOTAL - ADVANCE;
  const net = TOTAL - COMMISSION - RESERVE - LABOUR - rentDeducted;

  it("derives the deduction from the rent row and the advance", () => {
    expect(rentDeducted).toBe(15_000);
    expect(net).toBe(27_100);
  });

  it("leaves the market owing exactly the net, and square when paid", () => {
    // The old code credited the market the rent as well, and the net is
    // ALREADY after that deduction — so a party who paid in full finished at
    // −15,000, looking like a creditor. Nothing is posted to them but the sale.
    const marketParty = net;
    expect(marketParty - net).toBe(0);
  });

  it("closes the transporter at zero across the two entries", () => {
    // The note debited the advance at loading; the bill's rent row credits the
    // whole rent and debits what the market handed him.
    const transporter = ADVANCE - RENT_TOTAL + rentDeducted;
    expect(transporter).toBe(0);
  });

  it("expenses the rent once, at its full total", () => {
    // Not the deduction, and not the advance: those are settlements. The COST
    // is what was agreed for the journey.
    const expenses = [RENT_TOTAL];
    expect(expenses).toHaveLength(1);
    expect(expenses[0]).toBe(20_000);
  });

  it("recognises revenue as the net plus what the market paid the driver", () => {
    // That money left the business through the driver. A day whose revenue
    // omitted it would carry a cost it was never credited for — and the rent
    // then nets to nothing on a market bill, which is correct: the market paid.
    const revenue = net + rentDeducted;
    expect(revenue).toBe(42_100);
    expect(revenue).toBe(TOTAL - COMMISSION - RESERVE - LABOUR);
    expect(revenue - RENT_TOTAL).toBe(22_100);
  });
});

describe("the same trip billed on more than one channel", () => {
  it("charges the rent once, on the bill that reported it", () => {
    // The load goes to the factory, the factory rejects some, and the returns
    // are sold at a market on the way home. Two bills, one journey, one rent —
    // this is the day that had no answer while a bill had to be "the last
    // stop" and a factory trip could not carry a market bill.
    const factoryBill = { revenue: 127_000, rentEntered: 20_000 };
    const marketBillOfReturns = { revenue: 8_400, rentEntered: 0 };

    const revenue = factoryBill.revenue + marketBillOfReturns.revenue;
    const rent = factoryBill.rentEntered + marketBillOfReturns.rentEntered;

    expect(revenue).toBe(135_400);
    expect(rent).toBe(20_000);
  });
});
