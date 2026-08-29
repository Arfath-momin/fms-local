import { describe, expect, it } from "vitest";
import {
  DEFAULT_EXPENSE_CATEGORIES,
  DIRECT_CODES,
  EXPENSE_SPECS,
  expensePrepaid,
  expenseVendorName,
} from "@/lib/expense";
import { EXPENSE_LEDGER_TYPES, PARTY_TYPE_LABELS } from "@/lib/party";

/**
 * The line man — the person who unloads the fish at the market.
 *
 * He is paid per trip, on his own voucher, and he gets a LEDGER: BFM owes him
 * trip by trip, and what he is owed across a week is one man's account rather
 * than a share of a pooled "expense vendors" figure.
 */
describe("the line man head", () => {
  it("is a DIRECT cost, not an overhead", () => {
    // He is a cost of a particular day's fish. Charging him as an overhead
    // would keep him out of gross profit, which is the figure read every
    // morning — the day's catch would look cheaper than it was.
    const head = DEFAULT_EXPENSE_CATEGORIES.find((c) => c.code === "LINE_MAN");
    expect(head?.kind).toBe("DIRECT");
    expect(DIRECT_CODES).toContain("LINE_MAN");
  });

  it("takes a name and a payment, and nothing else", () => {
    const spec = EXPENSE_SPECS.LINE_MAN;
    expect(spec.fields.map((f) => f.name)).toEqual(["lineManName"]);
    // The amount is typed: there is no quantity and rate to multiply, he is
    // paid what he is paid.
    expect(spec.amountEntered).toBe(true);
    expect(spec.totalFrom).toBeUndefined();
  });

  it("is entered against a trip", () => {
    // Which is what dates the cost to the buying day the fish was bought on,
    // rather than to the day somebody typed the voucher (invariant 1).
    expect(EXPENSE_SPECS.LINE_MAN.tripLinked).toBe(true);
    expect(EXPENSE_SPECS.RENT.tripLinked).toBe(true);
    // Heads that have nothing to do with a trip do not offer the picker.
    expect(EXPENSE_SPECS.CANTEEN.tripLinked).toBeUndefined();
    expect(EXPENSE_SPECS.SALARY?.tripLinked).toBeUndefined();
  });

  it("posts to a LINE_MAN party, not an expense vendor", () => {
    expect(EXPENSE_SPECS.LINE_MAN.vendorType).toBe("LINE_MAN");
    expect(PARTY_TYPE_LABELS.LINE_MAN).toBe("Line Man");
    // His statement sits with the other people BFM pays for their work.
    expect(EXPENSE_LEDGER_TYPES).toContain("LINE_MAN");
  });

  it("names the ledger after the man, not after the head", () => {
    // "Line Man" as a vendor would pool every unloader in the district into one
    // account that cannot be paid — the same mistake local sellers once had.
    expect(
      expenseVendorName("LINE_MAN", "Line Man", { lineManName: "Suresh" })
    ).toBe("Suresh");
  });

  it("has nothing prepaid against it", () => {
    // Unlike the rent, which is settled by an advance and by whatever a market
    // hands the driver, a line man is simply paid.
    expect(EXPENSE_SPECS.LINE_MAN.prepaidFrom).toBeUndefined();
    expect(expensePrepaid("LINE_MAN", { lineManName: "Suresh" })).toBe(0);
  });
});
