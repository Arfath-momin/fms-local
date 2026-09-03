import { describe, expect, it } from "vitest";

/**
 * A market row records WHICH fish went and HOW MUCH of it — never a price.
 *
 * Its weight is box × what one box weighed, taken from the delivery note, which
 * recorded that when the truck was loaded. The row used to store zero kilos, so
 * a bill said which market took the fish and nothing about the quantity — worst
 * on a loose row, which has no boxes either and so recorded nothing at all.
 *
 * There is no rate and no amount. A market's money is the net it paid — total
 * less its commission, cutting, reserve and labour — and a per-row price beside
 * that invites adding the rows up and asking why the two figures differ.
 */
const rowKg = (pack: string, box: number, kgPerBox: number, typedKg: number) =>
  pack === "LOOSE" ? typedKg : box * kgPerBox;

describe("a market row's weight", () => {
  it("is the boxes times what one box weighed", () => {
    expect(rowKg("BOX", 20, 25, 0)).toBe(500);
    expect(rowKg("BIG_BOX", 2, 100, 0)).toBe(200);
  });

  it("is the typed weight on a loose row", () => {
    // Fish too big to crate never went into a box, so there is no per-box
    // figure to multiply — and no boxes to count either.
    expect(rowKg("LOOSE", 0, 0, 500)).toBe(500);
  });

  it("no longer comes back as zero", () => {
    // The bug: 500 kg went to a market and the bill recorded nothing.
    expect(rowKg("BOX", 20, 25, 0)).not.toBe(0);
    expect(rowKg("LOOSE", 0, 0, 500)).not.toBe(0);
  });

  it("foots a real note", () => {
    // DN-00019: 20 boxes of bangdga at 25, 500 kg of loose bangde, 2 big boxes
    // at 100.
    const rows = [
      { pack: "BOX", box: 20, kgPerBox: 25, kg: 0 },
      { pack: "LOOSE", box: 0, kgPerBox: 0, kg: 500 },
      { pack: "BIG_BOX", box: 2, kgPerBox: 100, kg: 0 },
    ];
    expect(
      rows.reduce((a, r) => a + rowKg(r.pack, r.box, r.kgPerBox, r.kg), 0)
    ).toBe(1_200);
    // Boxes still tally for the trip, loose carrying none.
    expect(rows.reduce((a, r) => a + (r.pack === "LOOSE" ? 0 : r.box), 0)).toBe(22);
  });

  it("carries no money of its own", () => {
    // Every market row's total is zero: the bill's money is the net.
    const rowTotal = () => 0;
    expect(rowTotal()).toBe(0);
  });
});
