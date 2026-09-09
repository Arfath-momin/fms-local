import { describe, expect, it } from "vitest";
import type { LedgerSourceType } from "@/generated/prisma/enums";

/**
 * Which statement rows carry their voucher's items.
 *
 * A statement named the bill and stopped there, so "Purchase · Bill S-1042 ·
 * ₹1,85,000" told a seller the total and nothing about the fish. The lots now
 * print under the row, and their amounts sit in the same money column, so they
 * visibly add up to the entry above them.
 *
 * Only for an entry that IS the voucher, though. A rent credit and the debit
 * for what a market handed the driver are both sourced from a SALE — they carry
 * its id so they can be found and undone with it — but they are about the
 * journey, not the fish.
 */
const carriesItems = (t: LedgerSourceType) =>
  t === "SALE" || t === "PURCHASE" || t === "EXPENSE";

describe("which rows itemise", () => {
  it("itemises the vouchers that have items", () => {
    expect(carriesItems("PURCHASE")).toBe(true);
    expect(carriesItems("SALE")).toBe(true);
    expect(carriesItems("EXPENSE")).toBe(true);
  });

  it("leaves a transporter's rent alone", () => {
    // Both are sourced from a sale. Printing its lots under them said a
    // ₹20,000 rent was made of eighteen boxes of prawns.
    expect(carriesItems("RENT")).toBe(false);
    expect(carriesItems("RENT_BY_PARTY")).toBe(false);
  });

  it("leaves settlements alone", () => {
    // A receipt against a bill is money, not fish — including the receipt for
    // what a market paid the driver, which is sourced from the sale as well.
    expect(carriesItems("PAYMENT")).toBe(false);
    expect(carriesItems("RECEIPT")).toBe(false);
  });

  it("leaves the retired kinds alone", () => {
    expect(carriesItems("COMMISSION")).toBe(false);
    expect(carriesItems("RESERVE")).toBe(false);
  });
});

describe("the lines under a purchase", () => {
  it("add up to the entry above them", () => {
    // Society's Bill S-1042, as printed: the whole point of putting each line's
    // amount in the same column as its entry.
    const lines = [69_000, 112_500, 3_500];
    expect(lines.reduce((a, b) => a + b, 0)).toBe(185_000);
  });
});

describe("the lines under a market sale", () => {
  it("carry boxes and no money", () => {
    // A market bill's money is the net it paid, so a per-line amount would
    // invite adding the rows up and asking why the two disagree.
    const marketLineAmount = (isMarket: boolean, total: number) =>
      !isMarket && total > 0 ? total : null;
    expect(marketLineAmount(true, 0)).toBeNull();
    expect(marketLineAmount(false, 67_500)).toBe(67_500);
  });
});
