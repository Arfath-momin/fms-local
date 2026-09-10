import { describe, expect, it } from "vitest";
import { expenseHighlight } from "@/lib/expense";

/**
 * The one thing worth seeing on a list of expenses.
 *
 * The lists showed a category, a vendor and an amount — so finding out how many
 * blocks of ice a ₹4,000 bill bought meant opening the voucher. Every head
 * already records the figure that explains its own total; this decides which
 * one that is, and the lists print it where the note used to sit.
 */
describe("what an expense row shows", () => {
  it("gives ice its blocks, the rate per block and its truck", () => {
    expect(
      expenseHighlight("ICE", {
        blocks: "40",
        ratePerBlock: "100",
        plantName: "Malpe Ice",
        vehicleNo: "KA20A9087",
      })
    ).toBe("40 blocks @ 100/block · KA20A9087");
  });

  it("still shows ice's blocks when no rate was recorded", () => {
    // Rows entered before the rate field existed, and rows where it was left
    // blank, must not print "40 blocks @ /block".
    expect(expenseHighlight("ICE", { blocks: "40", vehicleNo: "KA1" })).toBe(
      "40 blocks · KA1"
    );
    expect(expenseHighlight("ICE", { blocks: "40", ratePerBlock: "  " })).toBe(
      "40 blocks"
    );
  });

  it("does not print a rate with no blocks behind it", () => {
    // A rate alone says nothing about what was bought, and "@ 100/block" on
    // its own would read as a quantity.
    expect(expenseHighlight("ICE", { ratePerBlock: "100" })).toBeNull();
    expect(expenseHighlight("ICE", { ratePerBlock: "100", vehicleNo: "KA1" })).toBe(
      "KA1"
    );
  });

  it("gives loaders and ladies their boxes and the rate per box", () => {
    // The rate is what gets agreed with a gang, so it is the figure worth
    // seeing without dividing the total by the boxes to find it.
    expect(expenseHighlight("LOADERS", { boxes: "120", ratePerBox: "12.5" })).toBe(
      "120 boxes @ 12.5/box"
    );
    expect(expenseHighlight("LADIES", { boxes: "80", ratePerBox: "10" })).toBe(
      "80 boxes @ 10/box"
    );
  });

  it("still shows the boxes when no rate was recorded", () => {
    expect(expenseHighlight("LOADERS", { boxes: "120" })).toBe("120 boxes");
  });

  it("says nothing for a head with no such figure, so the note shows instead", () => {
    // Canteen and batha are a sum and a reason; there is no quantity behind
    // them, and an empty cell where the note used to be would be a loss.
    expect(expenseHighlight("CANTEEN", {})).toBeNull();
    expect(expenseHighlight("BATHA", {})).toBeNull();
    expect(expenseHighlight("SALARY", {})).toBeNull();
  });

  it("gives vehicle rent the truck, its owner and what is already paid", () => {
    // A list of rent vouchers was a column of "Vehicle Rent — —": the same two
    // words on every row, with no way to tell one journey from another.
    expect(
      expenseHighlight("RENT", {
        vehicleNo: "KA20A9087",
        transporter: "Shetty Carriers",
        advance: "5000",
      })
    ).toBe("KA20A9087 · Shetty Carriers · 5000 advance");
  });

  it("names what a market handed the driver, when it did", () => {
    expect(
      expenseHighlight("RENT", {
        vehicleNo: "KA20A9087",
        transporter: "Shetty Carriers",
        advance: "5000",
        paidByMarket: "3000",
      })
    ).toBe("KA20A9087 · Shetty Carriers · 5000 advance · 3000 by market");
  });

  it("prints whichever part of a rent voucher was filled in", () => {
    expect(expenseHighlight("RENT", { vehicleNo: "KA20A9087" })).toBe("KA20A9087");
    expect(expenseHighlight("RENT", { transporter: "NIMSHAN" })).toBe("NIMSHAN");
    // Nothing recorded at all still falls back to the note.
    expect(expenseHighlight("RENT", {})).toBeNull();
    expect(expenseHighlight("RENT", { vehicleNo: "  " })).toBeNull();
  });

  it("prints whichever half of an ice row was filled in", () => {
    // A bill with blocks but no truck, or a truck but no blocks, still says
    // what it knows rather than nothing.
    expect(expenseHighlight("ICE", { blocks: "40" })).toBe("40 blocks");
    expect(expenseHighlight("ICE", { vehicleNo: "KA20A9087" })).toBe("KA20A9087");
  });

  it("treats blank and missing the same", () => {
    // A detail typed and then cleared leaves an empty string behind it, which
    // must not print as "  blocks" or an orphaned separator.
    expect(expenseHighlight("ICE", { blocks: "", vehicleNo: "" })).toBeNull();
    expect(expenseHighlight("ICE", { blocks: "  ", vehicleNo: "KA1" })).toBe("KA1");
    expect(expenseHighlight("LOADERS", { boxes: "" })).toBeNull();
  });

  it("survives an expense with no details at all", () => {
    // Rows entered before a head had fields, and rows whose JSON is null.
    expect(expenseHighlight("ICE", null)).toBeNull();
    expect(expenseHighlight("ICE", undefined)).toBeNull();
    expect(expenseHighlight("LOADERS", {})).toBeNull();
  });

  it("says nothing for a head the merchant invented", () => {
    // Categories are rows: a company can add its own, and this must not throw
    // on one it has never heard of.
    expect(expenseHighlight("SOMETHING_NEW", { boxes: "10" })).toBeNull();
  });
});
