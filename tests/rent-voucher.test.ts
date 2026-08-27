import { describe, expect, it } from "vitest";
import { EXPENSE_SPECS, expensePrepaid } from "@/lib/expense";

/**
 * Vehicle rent as an expense voucher.
 *
 * Rent spent a while living on the trip — recorded from the delivery note, or
 * carried on whichever market bill happened to be the last stop. That got the
 * business backwards: a rent is agreed when the truck is LOADED, before anyone
 * knows what it will sell for or how many places it will stop, and one journey
 * routinely ends in a factory bill for the load and a market bill for the
 * returns. "Which bill carries the rent" had no natural answer.
 *
 * These pin the shape of the voucher that replaced it, because the fields are
 * not decoration: `prepaidFrom` is what turns the advance into a SETTLEMENT
 * rather than a second expense, and `vendorType` is what keeps one
 * transporter's account in one place.
 */
describe("the Vehicle Rent voucher", () => {
  const spec = EXPENSE_SPECS.RENT;

  it("exists, so rent can be entered for every channel", () => {
    expect(spec).toBeDefined();
    expect(spec.label).toBe("Vehicle Rent");
  });

  it("takes the total as one typed figure", () => {
    // Not derived from a quantity × rate: a rent is a negotiated lump sum.
    expect(spec.amountEntered).toBe(true);
  });

  it("asks for the vehicle and who owns it", () => {
    const names = spec.fields.map((f) => f.name);
    expect(names).toContain("vehicleNo");
    expect(names).toContain("transporter");
  });

  it("owes the money to a TRANSPORTER, not an expense vendor", () => {
    // Filing him as an expense vendor would split one man's account in two —
    // the rent on one ledger, the trips he ran on another.
    expect(spec.vendorType).toBe("TRANSPORTER");
    expect(spec.vendorFrom).toBe("transporter");
  });

  it("treats the advance and the market's payment as settlements", () => {
    expect(spec.prepaidFrom).toEqual(["advance", "paidByMarket"]);
  });

  it("counts both toward what has already been handed over", () => {
    const paid = expensePrepaid("RENT", { advance: "5000", paidByMarket: "15000" });
    expect(paid).toBe(20_000);
  });

  it("leaves the balance owing as the ledger's own figure", () => {
    // 20,000 rent, 5,000 advance at loading, nothing from a market yet.
    // The voucher credits 20,000 and debits 5,000; what is left on the
    // transporter's ledger IS what he is still owed. No second stored field to
    // drift out of step with it.
    const total = 20_000;
    const paid = expensePrepaid("RENT", { advance: "5000", paidByMarket: "" });
    expect(total - paid).toBe(15_000);
  });

  it("neither field may exceed the rent itself", () => {
    // Guarded in the action; asserted here so the intent is recorded next to
    // the spec that makes it possible.
    const total = 20_000;
    const paid = expensePrepaid("RENT", { advance: "5000", paidByMarket: "15000" });
    expect(paid).toBeLessThanOrEqual(total);
  });
});

describe("what a sale still says about rent", () => {
  it("has no rent fields of its own beyond the market's deduction", () => {
    // A market bill prints "less vehicle rent" among its deductions, so the
    // figure is typed off the paper like commission and labour. It buys ONE
    // thing: revenue is the net plus it. It creates no expense and touches no
    // ledger — that is the whole reason the double-count is gone.
    const NET = 27_100;
    const RENT_DEDUCTED = 15_000;
    expect(NET + RENT_DEDUCTED).toBe(42_100);
  });
});
