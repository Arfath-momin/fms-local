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
  it("gives ice its blocks and its truck", () => {
    expect(
      expenseHighlight("ICE", {
        blocks: "40",
        ratePerBlock: "100",
        plantName: "Malpe Ice",
        vehicleNo: "KA20A9087",
      })
    ).toBe("40 blocks · KA20A9087");
  });

  it("gives loaders and ladies their boxes", () => {
    expect(expenseHighlight("LOADERS", { boxes: "120", ratePerBox: "12.5" })).toBe(
      "120 boxes"
    );
    expect(expenseHighlight("LADIES", { boxes: "80", ratePerBox: "10" })).toBe(
      "80 boxes"
    );
  });

  it("says nothing for a head with no such figure, so the note shows instead", () => {
    // Canteen and batha are a sum and a reason; there is no quantity behind
    // them, and an empty cell where the note used to be would be a loss.
    expect(expenseHighlight("CANTEEN", {})).toBeNull();
    expect(expenseHighlight("BATHA", {})).toBeNull();
    expect(expenseHighlight("SALARY", {})).toBeNull();
    expect(expenseHighlight("RENT", { vehicleNo: "KA20A9087" })).toBeNull();
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
