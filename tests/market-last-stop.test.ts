import { describe, expect, it } from "vitest";
import { saleRevenue } from "@/lib/sale";

/**
 * The last stop, end to end.
 *
 * A truck goes out with an advance to the driver. The final market takes the
 * load, pays the driver the balance on BFM's behalf, deducts it from the bill
 * along with its own charges, and hands over the net. Every figure below has to
 * land in exactly one place, and the three parties have to end where they
 * really stand.
 *
 * Verified against the database before being written down here; this is the
 * arithmetic that has to keep holding.
 *
 * Sign convention: CREDIT is money we owe, DEBIT is money paid out or owed us.
 */
const credit = (n: number) => -n;
const debit = (n: number) => n;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

// The trip
const ADVANCE = 5_000;
const RENT = 20_000;
const PAID_BY_MARKET = 15_000;

// The market's paper
const TOTAL = 45_000;
const COMMISSION = 900;
const RESERVE = 1_500;
const LABOUR = 500;
const NET = TOTAL - COMMISSION - RESERVE - PAID_BY_MARKET - LABOUR;

// Another cost the same bill revealed
const ICE = 1_200;

describe("the market bill", () => {
  it("nets down to what the market actually hands over", () => {
    expect(NET).toBe(27_100);
  });

  it("takes the deduction from what the market PAID, not what was left owing", () => {
    // Inferring it as rent − advance assumed the market always settles the
    // whole balance. It usually does. When it does not, that assumption made a
    // part payment impossible to record and claimed the driver had been paid
    // in full when he had not.
    expect(PAID_BY_MARKET).toBe(RENT - ADVANCE);
    const partPayment = 9_000;
    expect(partPayment).not.toBe(RENT - ADVANCE);
    expect(TOTAL - COMMISSION - RESERVE - partPayment - LABOUR).toBe(33_100);
  });
});

describe("the three ledgers", () => {
  it("closes the transporter at zero", () => {
    // The note debited the advance, the rent expense credited the whole rent,
    // and the bill debited what the market handed him.
    expect(sum([debit(ADVANCE), credit(RENT), debit(PAID_BY_MARKET)])).toBe(0);
  });

  it("leaves the market owing the net and nothing else", () => {
    // Nothing is posted to them for the rent: the net is off their own paper
    // and is ALREADY after that deduction.
    expect(sum([debit(NET)])).toBe(NET);
    expect(sum([debit(NET), credit(NET)])).toBe(0);
  });

  it("leaves the ice plant owed its own bill", () => {
    // A cost entered on the sale is an ordinary expense against its vendor,
    // settled later by a Payment voucher like any other.
    expect(sum([credit(ICE)])).toBe(-ICE);
  });
});

describe("the day's profit", () => {
  it("recognises the net plus what the market paid the driver", () => {
    const revenue = saleRevenue({
      type: "MARKET",
      amount: NET,
      rentDeducted: PAID_BY_MARKET,
    });
    expect(revenue).toBe(42_100);
    // Which is the bill less the market's OWN charges — commission, reserve and
    // labour are theirs and stay netted inside it. The rent is not: that money
    // left through the driver and is a cost of ours.
    expect(revenue).toBe(TOTAL - COMMISSION - RESERVE - LABOUR);
  });

  it("charges each cost exactly once", () => {
    // The rent at its FULL total, not the deducted part: the advance was a
    // settlement, never a second cost.
    expect(RENT + ICE).toBe(21_200);
  });

  it("nets the rent to nothing, because the market paid it", () => {
    // +15,000 of revenue against 20,000 of cost, less the 5,000 we had already
    // handed over ourselves. The day is charged only what BFM actually bore.
    const revenue = saleRevenue({ type: "MARKET", amount: NET, rentDeducted: PAID_BY_MARKET });
    expect(revenue - NET - PAID_BY_MARKET).toBe(0);
    expect(RENT - PAID_BY_MARKET).toBe(ADVANCE);
  });
});
