import { describe, expect, it } from "vitest";
import { duplicateAt } from "@/app/(app)/vouchers/duplicate-row";

/**
 * Duplicating a row copies the PARTICULAR and nothing else.
 *
 * A load arrives as ten lots of prawns at different weights, and typing
 * "Prawns" ten times is ten chances to type it nine different ways — which is
 * how one particular becomes several on a report.
 *
 * Every figure comes across empty, and that is the safety of it. A duplicate
 * that arrived pre-filled and was saved unedited would book the same fish
 * twice, on a voucher where nothing would look wrong.
 */
type SaleRow = {
  pack: string;
  particular: string;
  box: string;
  qtyKg: string;
  ratePerKg: string;
};

const BLANK: SaleRow = {
  pack: "BOX",
  particular: "",
  box: "",
  qtyKg: "",
  ratePerKg: "",
};

const row = (over: Partial<SaleRow>): SaleRow => ({ ...BLANK, ...over });

describe("duplicating a line", () => {
  it("carries the particular over", () => {
    const lines = [row({ particular: "Prawns", box: "40", ratePerKg: "150" })];
    expect(duplicateAt(lines, 0, BLANK)[1].particular).toBe("Prawns");
  });

  it("carries no figure over at all", () => {
    const lines = [
      row({ particular: "Prawns", box: "40", qtyKg: "800", ratePerKg: "150" }),
    ];
    const copy = duplicateAt(lines, 0, BLANK)[1];
    expect(copy.box).toBe("");
    expect(copy.qtyKg).toBe("");
    expect(copy.ratePerKg).toBe("");
  });

  it("puts the copy directly below its source", () => {
    // A list of lots reads in the order they were unloaded. A copy that jumped
    // to the bottom would lose that.
    const lines = [
      row({ particular: "Prawns" }),
      row({ particular: "Mackerel" }),
      row({ particular: "Sardine" }),
    ];
    expect(duplicateAt(lines, 1, BLANK).map((l) => l.particular)).toEqual([
      "Prawns",
      "Mackerel",
      "Mackerel",
      "Sardine",
    ]);
  });

  it("leaves the source row untouched", () => {
    const lines = [row({ particular: "Prawns", box: "40" })];
    const after = duplicateAt(lines, 0, BLANK);
    expect(after[0]).toEqual(lines[0]);
    expect(after[0]).not.toBe(after[1]);
  });

  it("handles the delivery note's spelling of the field", () => {
    // Sale and purchase lines call it `particular`; a delivery note line calls
    // it `particulars`. One helper, so the three screens cannot drift into
    // copying different things.
    type NoteRow = { particulars: string; box: string };
    const blank: NoteRow = { particulars: "", box: "" };
    const lines: NoteRow[] = [{ particulars: "Bangda", box: "25" }];
    const copy = duplicateAt(lines, 0, blank)[1];
    expect(copy.particulars).toBe("Bangda");
    expect(copy.box).toBe("");
  });

  it("adds exactly one row", () => {
    const lines = [row({ particular: "A" }), row({ particular: "B" })];
    expect(duplicateAt(lines, 0, BLANK)).toHaveLength(3);
  });
});
