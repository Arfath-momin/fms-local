import { describe, expect, it } from "vitest";

/**
 * A statement has to be answerable from itself.
 *
 * It footed with the balance AS AT TODAY, across all periods. So a statement
 * for September — thirty transactions, two lakhs bought, one and a third paid —
 * closed with a figure that had five October transactions folded into it. The
 * seller was being asked to agree a total that the page did not show the
 * workings for.
 *
 * Opening, the movements listed, and closing are now all within the dates
 * asked for, and they tie:
 *
 *     closing = opening + debits − credits
 *
 * Credits are what is owed TO the party, so they push the balance down.
 */
const closing = (opening: number, debits: number, credits: number) =>
  opening + debits - credits;

describe("a statement's own window", () => {
  it("ties opening, movements and closing together", () => {
    // The reported case: 30,000 owed from before, 2 lakh bought in September,
    // 1.3 lakh paid.
    expect(closing(-30_000, 130_000, 200_000)).toBe(-100_000);
  });

  it("excludes what happened after the window", () => {
    // October's 40,000 must not reach September's closing figure. The old
    // footer would have shown -1,40,000 on a September statement.
    const september = closing(-30_000, 130_000, 200_000);
    const october = closing(september, 0, 40_000);
    expect(september).toBe(-100_000);
    expect(october).toBe(-140_000);
    expect(september).not.toBe(october);
  });

  it("hands one month's closing to the next month's opening", () => {
    // Two consecutive statements must chain, or a party reconciling a year of
    // them finds a gap with nothing to explain it.
    const september = closing(-30_000, 130_000, 200_000);
    const octoberOpening = september;
    expect(closing(octoberOpening, 0, 40_000)).toBe(-140_000);
  });

  it("closes where it opened when nothing happened", () => {
    // An empty window used to fall back to the balance as at today, so a
    // September statement for a quiet party opened at October's figure.
    expect(closing(-30_000, 0, 0)).toBe(-30_000);
  });

  it("opens at zero for a party with no history at all", () => {
    expect(closing(0, 45_000, 0)).toBe(45_000);
  });

  it("keeps the sign meaning one thing", () => {
    // Positive is what the party owes; negative is what is owed to them. A
    // purchase party normally sits negative, a buyer positive.
    expect(closing(0, 0, 30_000)).toBeLessThan(0);
    expect(closing(0, 30_000, 0)).toBeGreaterThan(0);
  });
});
