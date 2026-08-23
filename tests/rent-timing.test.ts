import { describe, expect, it } from "vitest";

/**
 * The rent settlement chain, with the total arriving LATE.
 *
 * The total rent depends on the kilometres the driver covers, so it cannot be
 * known at dispatch. Only the advance is. This is the sequence the merchant
 * asked to see, and the arithmetic that has to hold for it.
 *
 * Sign convention, as everywhere: CREDIT is money we owe, DEBIT is money owed
 * to us or already paid out.
 */
const credit = (n: number) => -n;
const debit = (n: number) => n;

describe("rent recorded at the last market stop", () => {
  const RENT_TOTAL = 20_000;
  const ADVANCE = 5_000;
  const CARRIED = RENT_TOTAL - ADVANCE; // what the last market handed the driver

  it("closes the transporter at zero across the two vouchers", () => {
    const transporter = [
      // 2. delivery note — advance paid at departure
      debit(ADVANCE),
      // 4. market sale — the whole rent, now that it is known
      credit(RENT_TOTAL),
      // 5. market sale — what the market handed him, settling the balance
      debit(CARRIED),
    ];
    expect(transporter.reduce((a, b) => a + b, 0)).toBe(0);
  });

  it("leaves us PREPAID between dispatch and the bill coming back", () => {
    // Bills arrive two or three days later, so this is the normal state for
    // most of a trip's life. A positive balance reads as "we have paid him
    // 5,000 against a rent not yet recorded", which is exactly true.
    const beforeBill = [debit(ADVANCE)];
    expect(beforeBill.reduce((a, b) => a + b, 0)).toBe(5_000);
  });

  it("leaves the market party owing the net and nothing more", () => {
    const NET = 43_400;
    const marketParty = [
      // 3. the sale itself
      debit(NET),
      // 5. they paid the driver on BFM's behalf, so they are not out of pocket
      credit(CARRIED),
    ];
    // They owe the net less what they already handed over for us.
    expect(marketParty.reduce((a, b) => a + b, 0)).toBe(NET - CARRIED);
  });

  it("expenses the rent once, at the total — never the advance separately", () => {
    // The advance is a SETTLEMENT against the rent, not a second cost
    // (invariant 2). Charging both would double the day's rent.
    const expenses = [RENT_TOTAL];
    expect(expenses.reduce((a, b) => a + b, 0)).toBe(20_000);
    expect(expenses).toHaveLength(1);
  });
});

describe("the market bill's balancing item", () => {
  it("derives labour/other from the net the market actually paid", () => {
    // The market hands over a bill with the total and the net printed on it,
    // and names commission, reserve and rent. Whatever is left between them is
    // the two or three sundry charges nobody itemises.
    const total = 80_000;
    const commission = 1_600; // 2%
    const reserve = 2_500;
    const rent = 15_000;
    const net = 60_000; // typed from the paper

    const other = total - commission - reserve - rent - net;
    expect(other).toBe(900);

    // And it reconciles back the way the bill reads.
    expect(total - commission - other - reserve - rent).toBe(net);
  });

  it("rejects a net that leaves the deductions over-drawn", () => {
    const total = 50_000;
    const named = 1_000 + 2_000 + 15_000;
    const net = 40_000;
    // 18,000 + 40,000 = 58,000 against a 50,000 bill — impossible.
    expect(total - named - net).toBeLessThan(0);
  });
});
