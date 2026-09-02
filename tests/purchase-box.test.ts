import { describe, expect, it } from "vitest";

/**
 * A Private or Local purchase is counted in BOXES.
 *
 * Those sellers land fish in boxes and quote what one box weighs, so the row's
 * weight is box × kg-per-box — not a figure anybody put on a scale. A Society
 * or KFDC bill states its kilos outright and carries no boxes at all.
 *
 * The per-box figure is DERIVED wherever it is shown, never stored beside the
 * weight: two figures that must agree are two figures that can disagree, and
 * the one that gets corrected is never the copy.
 */
const rowKg = (box: number, kgPerBox: number) => box * kgPerBox;
const kgPerBox = (qtyKg: number, box: number) => (box > 0 ? qtyKg / box : 0);

describe("a boxed purchase line", () => {
  it("derives the row's weight from the boxes", () => {
    expect(rowKg(10, 20)).toBe(200);
    expect(rowKg(7, 15.5)).toBe(108.5);
  });

  it("works the per-box weight back out for display", () => {
    // What the edit form has to show when the bill is reopened. It round-trips
    // exactly, which is why only the total is stored.
    expect(kgPerBox(200, 10)).toBe(20);
    expect(kgPerBox(108.5, 7)).toBe(15.5);
  });

  it("totals the boxes and the kilos separately", () => {
    const rows: [number, number][] = [
      [10, 20],
      [20, 15],
      [5, 12],
    ];
    expect(rows.reduce((a, [b]) => a + b, 0)).toBe(35);
    expect(rows.reduce((a, [b, k]) => a + rowKg(b, k), 0)).toBe(560);
  });

  it("prices on the derived weight", () => {
    // 10 boxes of 20 kg at 150 is 30,000 — the rate is per KILO, not per box.
    expect(rowKg(10, 20) * 150).toBe(30_000);
  });

  it("carries no boxes on a Society or KFDC line", () => {
    // Those bills state their kilos, and a zero box count must not be read as
    // "no weight" — nor divided by when showing a per-box figure.
    expect(kgPerBox(1_100, 0)).toBe(0);
    expect(rowKg(0, 0)).toBe(0);
  });
});
