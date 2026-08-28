import "dotenv/config";
import { describe, expect, it } from "vitest";
import { expenseEntryAmount, expenseEntryVendor, specFor } from "@/lib/expense-entry";

/**
 * A cost entered on a bill is a FINISHED cost.
 *
 * The panel on a sale used to take a head, a name and an amount. Everything the
 * head actually asks for — ice's blocks and rate per block, the plant it came
 * from, the slip number — had to be filled in a second time under Vouchers →
 * Expenses. Two visits to record one thing, and until the second one the
 * voucher said "Ice ₹1,200" and nothing else.
 *
 * The drawer asks the same questions the voucher does, and these pin the rules
 * they share. Not the markup: one is a page and one is a drawer, and forcing
 * them into one component would make both worse. The ARITHMETIC, because two
 * copies of "ice is blocks × rate per block" is the pair that drifts, and the
 * day they disagree the ledger is wrong and nothing says so.
 */
const ICE = { code: "ICE", name: "Ice", allowsLines: false };
const LOADERS = { code: "LOADERS", name: "Loaders", allowsLines: false };
const CANTEEN = { code: "CANTEEN", name: "Canteen", allowsLines: false };
const RENT = { code: "RENT", name: "Vehicle Rent", allowsLines: false };
const OTHER = { code: "OTHER", name: "Other", allowsLines: true };
const MADE_UP = { code: "ELECTRICITY", name: "Electricity", allowsLines: false };

const ok = (r: { error: string } | { amount: string }) => {
  if ("error" in r) throw new Error(`unexpected error: ${r.error}`);
  return r.amount;
};

describe("what a head comes to", () => {
  it("multiplies ice out of its blocks and rate", () => {
    const amount = ok(
      expenseEntryAmount(
        ICE,
        { plantName: "Malpe Ice", blocks: "40", ratePerBlock: "30" },
        ""
      )
    );
    expect(amount).toBe("1200.00");
  });

  it("multiplies loaders out of boxes and rate per box", () => {
    expect(
      ok(expenseEntryAmount(LOADERS, { boxes: "150", ratePerBox: "6" }, ""))
    ).toBe("900.00");
  });

  it("takes a flat head's figure as typed", () => {
    expect(ok(expenseEntryAmount(CANTEEN, {}, "450"))).toBe("450");
  });

  it("sums an itemised head from its rows", () => {
    expect(
      ok(
        expenseEntryAmount(OTHER, {}, "", [
          { description: "Rope", amount: "300" },
          { description: "Tarpaulin", amount: "1200" },
          // The empty row at the bottom of the table is not an error.
          { description: "", amount: "" },
        ])
      )
    ).toBe("1500.00");
  });

  it("gives a merchant-added head a plain amount and no fields", () => {
    // No spec means a head added from Masters. That fallback is what lets them
    // add one without a deploy.
    const spec = specFor(MADE_UP);
    expect(spec.fields).toHaveLength(0);
    expect(spec.amountEntered).toBe(true);
    expect(ok(expenseEntryAmount(MADE_UP, {}, "2500"))).toBe("2500");
  });
});

describe("what it refuses", () => {
  it("names the field a required answer is missing from", () => {
    const r = expenseEntryAmount(ICE, { blocks: "40", ratePerBlock: "30" }, "");
    expect("error" in r && r.error).toContain("Ice Plant Name");
  });

  it("rejects a quantity that is not a positive number", () => {
    const r = expenseEntryAmount(
      ICE,
      { plantName: "Malpe Ice", blocks: "-4", ratePerBlock: "30" },
      ""
    );
    expect("error" in r).toBe(true);
  });

  it("rejects a flat head with no figure", () => {
    expect("error" in expenseEntryAmount(CANTEEN, {}, "")).toBe(true);
  });

  it("rejects an itemised head with nothing itemised", () => {
    const r = expenseEntryAmount(OTHER, {}, "", [
      { description: "", amount: "" },
    ]);
    expect("error" in r && r.error).toContain("at least one");
  });

  it("rejects an itemised row with an amount and no description", () => {
    const r = expenseEntryAmount(OTHER, {}, "", [
      { description: "", amount: "300" },
    ]);
    expect("error" in r && r.error).toContain("no description");
  });
});

describe("who it is owed to", () => {
  it("reads the vendor out of the head's own field", () => {
    expect(
      expenseEntryVendor(ICE, { plantName: "Malpe Ice Plant" })
    ).toBe("Malpe Ice Plant");
  });

  it("gives none where a head has nobody to owe", () => {
    // A canteen bill is paid as it is incurred. Forcing a name would fill the
    // party master with junk nobody settles against.
    expect(expenseEntryVendor(CANTEEN, {})).toBe("");
  });

  it("owes vehicle rent to a TRANSPORTER, not an expense vendor", () => {
    // Filing him as an expense vendor would split one man's account in two:
    // the rent on one ledger, the trips he ran on another.
    expect(specFor(RENT).vendorType).toBe("TRANSPORTER");
    expect(expenseEntryVendor(RENT, { transporter: "Ravi Transport" })).toBe(
      "Ravi Transport"
    );
  });
});
