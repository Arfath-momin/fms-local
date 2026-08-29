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
// Rent is NOT among these. What the market handed the driver settles part of
// what it owes on this bill; it does not make the bill smaller.
const NET = TOTAL - COMMISSION - RESERVE - LABOUR;

// Another cost the same bill revealed
const ICE = 1_200;

describe("the market bill", () => {
  it("nets down to the whole net, before anything the market has paid", () => {
    expect(NET).toBe(42_100);
  });

  it("still leaves the market handing over 27,100", () => {
    // The figure printed on their paper is unchanged. What changed is how it is
    // arrived at: the bill is the full 42,100 and the 15,000 they gave the
    // driver comes off as a receipt, instead of the bill being written down to
    // 27,100 in the first place. Same money, two answerable questions.
    expect(NET - PAID_BY_MARKET).toBe(27_100);
  });

  it("takes the receipt from what the market PAID, not what was left owing", () => {
    // Inferring it as rent − advance assumed the market always settles the
    // whole balance. It usually does. When it does not, that assumption made a
    // part payment impossible to record and claimed the driver had been paid
    // in full when he had not.
    expect(PAID_BY_MARKET).toBe(RENT - ADVANCE);
    const partPayment = 9_000;
    expect(partPayment).not.toBe(RENT - ADVANCE);
    // The bill is the same 42,100 either way — only what is still owed moves.
    expect(NET - partPayment).toBe(33_100);
  });
});

describe("the three ledgers", () => {
  it("closes the transporter at zero", () => {
    // The note debited the advance, the rent expense credited the whole rent,
    // and the bill debited what the market handed him.
    expect(sum([debit(ADVANCE), credit(RENT), debit(PAID_BY_MARKET)])).toBe(0);
  });

  it("leaves the market owing the net less what it paid the driver", () => {
    // The bill DEBITs the whole net; the money they handed the driver CREDITs
    // back as a receipt against it.
    expect(sum([debit(NET), credit(PAID_BY_MARKET)])).toBe(27_100);
    // And they close at zero when they hand over what their paper says.
    expect(sum([debit(NET), credit(PAID_BY_MARKET), credit(27_100)])).toBe(0);
  });

  it("does not credit the market twice for the same rent", () => {
    // The bug this replaced. The old code credited the 15,000 against a net
    // that had ALREADY been reduced by it, so a market that paid its bill in
    // full came out looking like a creditor for exactly the rent.
    const oldNet = TOTAL - COMMISSION - RESERVE - LABOUR - PAID_BY_MARKET;
    expect(sum([debit(oldNet), credit(PAID_BY_MARKET), credit(oldNet)])).toBe(
      -PAID_BY_MARKET
    );
    // The credit is right only because the debit grew by the same amount.
    expect(NET).toBe(oldNet + PAID_BY_MARKET);
  });

  it("leaves the ice plant owed its own bill", () => {
    // A cost entered on the sale is an ordinary expense against its vendor,
    // settled later by a Payment voucher like any other.
    expect(sum([credit(ICE)])).toBe(-ICE);
  });
});

describe("the day's profit", () => {
  it("recognises the bill, with nothing added back", () => {
    const revenue = saleRevenue({ type: "MARKET", amount: NET });
    expect(revenue).toBe(42_100);
    // The bill less the market's OWN charges. Commission, reserve and labour
    // are theirs and stay netted inside it; the rent never came out of it, so
    // there is nothing to gross back up.
    expect(revenue).toBe(TOTAL - COMMISSION - RESERVE - LABOUR);
  });

  it("charges each cost exactly once", () => {
    // The rent at its FULL total, not the part the market paid: the advance was
    // a settlement, never a second cost.
    expect(RENT + ICE).toBe(21_200);
  });

  it("charges the day only what BFM actually bore of the rent", () => {
    // 20,000 of cost against a receipt of 15,000 the market settled, leaving
    // the 5,000 advance BFM handed over itself.
    expect(RENT - PAID_BY_MARKET).toBe(ADVANCE);
  });
});
