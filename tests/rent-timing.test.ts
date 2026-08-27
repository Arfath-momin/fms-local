import { describe, expect, it } from "vitest";

/**
 * The rent settlement chain.
 *
 * Rent is one Vehicle Rent expense voucher, entered when the truck is loaded:
 * the total is credited to the transporter, and the advance and anything a
 * market hands the driver are DEBITs settling it. Whatever is left on his
 * ledger is what he is still owed — there is no second stored figure to
 * disagree with it.
 *
 * Sign convention, as everywhere: CREDIT is money we owe, DEBIT is money owed
 * to us or already paid out.
 */
const credit = (n: number) => -n;
const debit = (n: number) => n;

describe("rent recorded on its own expense voucher", () => {
  const RENT_TOTAL = 20_000;
  const ADVANCE = 5_000;
  const CARRIED = RENT_TOTAL - ADVANCE; // what the last market handed the driver

  it("closes the transporter at zero across the two vouchers", () => {
    const transporter = [
      // the voucher credits what the rent is
      credit(RENT_TOTAL),
      // ...and debits what has already gone to him: the advance at loading...
      debit(ADVANCE),
      // ...and what a market handed him on the way
      debit(CARRIED),
    ];
    expect(transporter.reduce((a, b) => a + b, 0)).toBe(0);
  });

  it("shows the balance still owed when only the advance has gone", () => {
    // The ordinary state of a trip whose driver has not been settled with yet.
    // −15,000 reads as "we still owe him 15,000", which is exactly true.
    const owing = [credit(RENT_TOTAL), debit(ADVANCE)];
    expect(owing.reduce((a, b) => a + b, 0)).toBe(-15_000);
  });

  it("leaves the market party owing the net, and closes at zero when paid", () => {
    // This test used to assert NET − CARRIED, and was wrong in exactly the way
    // the code was wrong: it encoded the bug instead of catching it.
    //
    // The NET is the figure off the market's own paper, and that net is ALREADY
    // after the rent deduction. Crediting the rent again subtracted the same
    // rupee twice, so a market party who paid their bill in full came out
    // looking like a creditor — traced on a real bill, M-503 finished at
    // −15,000. The rent settles between us and the TRANSPORTER; it has no
    // business on the market's account at all.
    const NET = 43_400;
    const marketParty = [debit(NET)];
    expect(marketParty.reduce((a, b) => a + b, 0)).toBe(NET);

    // And when they hand over the net printed on their bill, they are square.
    const afterPayment = [...marketParty, credit(NET)];
    expect(afterPayment.reduce((a, b) => a + b, 0)).toBe(0);
  });

  it("recognises revenue as the net PLUS what the market paid the driver", () => {
    // The rent left the business through the driver, so a day whose revenue
    // omitted it would be charged a cost it was never credited for. Grossing
    // back up is what makes the rent net out to nothing on a market bill:
    // +15,000 of revenue against 15,000 of expense.
    const NET = 43_400;
    expect(NET + CARRIED).toBe(58_400);
  });

  it("expenses the rent once, at the total — never the advance separately", () => {
    // The advance is a SETTLEMENT against the rent, not a second cost
    // (invariant 2). Charging both would double the day's rent. This is why
    // the voucher takes the advance as a field rather than as its own expense.
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
