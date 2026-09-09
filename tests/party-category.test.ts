import { describe, expect, it } from "vitest";
import { partyCategory } from "@/lib/party";

/**
 * What kind of account a party is, for the head of their statement and the
 * name of the file it downloads as.
 *
 * "Statement for Cool Ice" does not say whether Cool Ice is a boat owner, a
 * buyer or the plant the ice comes from, and a folder of fifty statements
 * sorted by nothing useful is the same problem fifty times over.
 */
describe("naming what an account is", () => {
  it("separates the four ways fish is bought", () => {
    // Every seller used to print as "Purchase Party" whether the fish came
    // through the Society, KFDC or a man on the beach — the three things a
    // merchant is actually separating.
    expect(partyCategory("PURCHASE_GROUP", "SOCIETY")).toBe("Society Purchase");
    expect(partyCategory("PURCHASE_GROUP", "KFDC")).toBe("KFDC Purchase");
    expect(partyCategory("PURCHASE_GROUP", "PRIVATE")).toBe("Private Purchase");
    expect(partyCategory("PURCHASE_GROUP", "LOCAL")).toBe("Local Purchase");
  });

  it("still names a seller whose kind was never filled in", () => {
    // purchaseKind is null on parties that predate the field.
    expect(partyCategory("PURCHASE_GROUP", null)).toBe("Purchase");
  });

  it("says which channel a buyer bought through", () => {
    expect(partyCategory("MARKET_BUYER")).toBe("Market Sale");
    expect(partyCategory("FACTORY")).toBe("Factory Sale");
    expect(partyCategory("FISH_MILL")).toBe("Fish Mill Sale");
    expect(partyCategory("LOCAL_BUYER")).toBe("Local Sale");
  });

  it("names an expense vendor by the head they are paid under", () => {
    expect(partyCategory("EXPENSE_VENDOR", null, ["Ice"])).toBe("Ice Expense");
    expect(partyCategory("EXPENSE_VENDOR", null, ["Loaders"])).toBe("Loaders Expense");
    expect(partyCategory("EXPENSE_VENDOR", null, ["Ladies"])).toBe("Ladies Expense");
  });

  it("falls back to plain Expense when a vendor does more than one thing", () => {
    // Only "Expense" is true of all of them; picking the first would name the
    // account after whichever head happened to sort first.
    expect(partyCategory("EXPENSE_VENDOR", null, ["Ice", "Loaders"])).toBe("Expense");
    // …and when they have been paid for nothing yet.
    expect(partyCategory("EXPENSE_VENDOR", null, [])).toBe("Expense");
  });

  it("treats a repeated head as one", () => {
    // The query is distinct by category, but a caller that is not must not
    // turn one head into "Expense".
    expect(partyCategory("EXPENSE_VENDOR", null, ["Ice", "Ice"])).toBe("Ice Expense");
    expect(partyCategory("EXPENSE_VENDOR", null, ["Ice", "  "])).toBe("Ice Expense");
  });

  it("names the rest from the party type", () => {
    expect(partyCategory("TRANSPORTER")).toBe("Transport");
    expect(partyCategory("LINE_MAN")).toBe("Line Man");
    expect(partyCategory("BOAT")).toBe("Boat");
  });
});
