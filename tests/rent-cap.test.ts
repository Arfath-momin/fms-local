import { describe, expect, it } from "vitest";

/**
 * When the "driver cannot be handed more than he is owed" cap applies.
 *
 * A truck stops at three markets. The rent is ONE cost, entered once, and at
 * most one of those bills settles any of it. The other two are ordinary bills
 * that happen to come off the same trip and have nothing to do with the rent.
 *
 * The cap was checked on every market bill regardless, so a trip that had paid
 * the driver an advance made every bill off it unsaveable: with no rent row the
 * sum read "the advance of 5,000 and the 0.00 this market paid come to more
 * than the rent of 0.00" — true, and completely beside the point. The first
 * market to unload had to invent a rent voucher it did not owe.
 */
const cap = (rentTotal: number, paidByMarket: number, advance: number) => {
  const carriesRent = rentTotal > 0 || paidByMarket > 0;
  return carriesRent && advance + paidByMarket > rentTotal;
};

const ADVANCE = 5_000;
const RENT = 20_000;

describe("the rent cap on a market bill", () => {
  it("ignores a bill that has nothing to do with the rent", () => {
    // The first stop of three. It sells fish and that is all. The trip's
    // advance is real, but it is the rent voucher's business, not this bill's.
    expect(cap(0, 0, ADVANCE)).toBe(false);
  });

  it("still ignores it when the trip paid no advance either", () => {
    expect(cap(0, 0, 0)).toBe(false);
  });

  it("lets the last stop settle the balance exactly", () => {
    // Advance 5,000 already gone, this market hands the driver the other
    // 15,000. Together they come to the rent, not more than it.
    expect(cap(RENT, RENT - ADVANCE, ADVANCE)).toBe(false);
  });

  it("allows a part payment, which is the whole reason it is typed", () => {
    // The market gives him 9,000 of the 15,000 outstanding. The transporter is
    // left genuinely owed 6,000, and that signal must not be suppressed.
    expect(cap(RENT, 9_000, ADVANCE)).toBe(false);
  });

  it("refuses to hand the driver more than he is owed", () => {
    // 5,000 advance plus 18,000 would leave the transporter 3,000 in credit —
    // "we have overpaid him", a figure nobody could act on.
    expect(cap(RENT, 18_000, ADVANCE)).toBe(true);
  });

  it("refuses a payment recorded against no rent at all", () => {
    // A rent row with a payment typed into it but no total. The cap has to
    // catch this one, which is why it keys off the payment as well as the rent.
    expect(cap(0, 15_000, 0)).toBe(true);
  });
});
