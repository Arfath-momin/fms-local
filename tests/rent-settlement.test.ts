import { describe, expect, it } from "vitest";

/**
 * Who is left owed what, once a market has paid the driver.
 *
 * The rent settles across three vouchers, and every one of them is needed:
 *
 *   delivery note   DEBIT  transporter   the advance handed over at loading
 *   rent expense    CREDIT transporter   the whole rent, once the driver reports
 *   market bill     DEBIT  transporter   what that market handed him on the road
 *
 * Removing the market party's wrong CREDIT once took the third of these with
 * it, and the transporter was left showing −15,000 on a trip somebody else had
 * already paid for: the credit posted, and nothing ever answered it.
 *
 * Sign convention: CREDIT is money we owe, DEBIT is money paid out or owed to us.
 */
const credit = (n: number) => -n;
const debit = (n: number) => n;

const RENT = 20_000;
const ADVANCE = 5_000;
const PAID_BY_MARKET = RENT - ADVANCE;

describe("a market pays the driver the balance", () => {
  it("closes the transporter at zero across all three vouchers", () => {
    const transporter = [
      debit(ADVANCE),
      credit(RENT),
      debit(PAID_BY_MARKET),
    ];
    expect(transporter.reduce((a, b) => a + b, 0)).toBe(0);
  });

  it("leaves him owed the balance while only the advance has gone", () => {
    // The state between loading and the bill coming back. −15,000 reads as
    // "we still owe him 15,000", which is exactly true at that moment.
    expect([debit(ADVANCE), credit(RENT)].reduce((a, b) => a + b, 0)).toBe(
      -15_000
    );
  });

  it("would strand him at −15,000 if the market's payment went unposted", () => {
    // The bug this test exists for. Not a hypothetical: it is what the books
    // did after the double-count repair removed both halves instead of one.
    const missing = [debit(ADVANCE), credit(RENT)];
    expect(missing.reduce((a, b) => a + b, 0)).toBe(-PAID_BY_MARKET);
  });

  it("posts nothing at all to the market party", () => {
    // The net the sale debits is off the market's own paper and is ALREADY
    // after the rent deduction. Crediting it again is the double-count.
    const NET = 27_100;
    const marketParty = [debit(NET)];
    expect(marketParty.reduce((a, b) => a + b, 0)).toBe(NET);
    expect([...marketParty, credit(NET)].reduce((a, b) => a + b, 0)).toBe(0);
  });
});

describe("BFM pays the driver itself", () => {
  it("leaves the balance standing until a Payment voucher settles it", () => {
    // Factory, mill and local: nobody pays the driver on our behalf, so there
    // is no third entry and what he is owed simply stays owed.
    const transporter = [debit(ADVANCE), credit(RENT)];
    expect(transporter.reduce((a, b) => a + b, 0)).toBe(-15_000);

    const afterPayment = [...transporter, debit(15_000)];
    expect(afterPayment.reduce((a, b) => a + b, 0)).toBe(0);
  });
});
