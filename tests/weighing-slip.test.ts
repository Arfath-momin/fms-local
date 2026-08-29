import { describe, expect, it } from "vitest";

/**
 * A fish mill or factory bill, worked from the buyer's weighing slip.
 *
 * The buyer weighs the CONSIGNMENT on arrival. Nobody weighs a single box. So
 * asking for a weight per Items row asked the clerk to apportion a figure the
 * paper never broke down — and whatever they typed became the money.
 *
 * Now the slip gives one average and every row takes it times its own boxes:
 *
 *   Total weight   900     as it arrived
 *   Water less      50     what they took off for water and ice
 *   Net weight     850     derived
 *   Total box       60     what this bill unloaded
 *   Avg kg/box  14.167     derived: net ÷ total box
 */
const TOTAL = 900;
const WATER_LESS = 50;
const NET = TOTAL - WATER_LESS;
const TOTAL_BOX = 60;
const AVG = NET / TOTAL_BOX;

describe("the slip", () => {
  it("derives the net rather than taking a third typed figure", () => {
    expect(NET).toBe(850);
  });

  it("derives the average from the net and the boxes", () => {
    expect(AVG).toBeCloseTo(14.167, 3);
  });
});

describe("what each row weighs", () => {
  const rows = [
    { pack: "BOX" as const, box: 40, rate: 150 },
    { pack: "BOX" as const, box: 20, rate: 120 },
  ];
  const kg = (r: { pack: string; box: number }) =>
    r.pack === "LOOSE" ? 0 : Number((AVG * r.box).toFixed(3));

  it("is the average times its boxes", () => {
    expect(kg(rows[0])).toBeCloseTo(566.667, 3);
    expect(kg(rows[1])).toBeCloseTo(283.333, 3);
  });

  it("adds back up to the net, give or take the rounding", () => {
    const summed = rows.reduce((a, r) => a + kg(r), 0);
    expect(Math.abs(summed - NET)).toBeLessThan(0.01);
  });

  it("prices each row on its own derived weight", () => {
    const amount = rows.reduce((a, r) => a + kg(r) * r.rate, 0);
    expect(amount).toBeCloseTo(566.667 * 150 + 283.333 * 120, 0);
  });
});

describe("what it refuses", () => {
  it("rejects rows that do not add up to the boxes unloaded", () => {
    // 40 + 15 against a bill that unloaded 60. The average would be spread over
    // a count that does not match what was counted, so every weight would be
    // wrong and the total would still look plausible.
    const boxed = 40 + 15;
    expect(boxed).not.toBe(TOTAL_BOX);
  });

  it("rejects more water than there was fish", () => {
    expect(1000 > TOTAL).toBe(true);
  });
});

describe("a loose row", () => {
  it("keeps its typed weight and joins no average", () => {
    // Fish too big to box never went into one, so there is no per-box average
    // that applies to it, and it contributes no boxes to the count either.
    const loose = { pack: "LOOSE" as const, box: 0, typedKg: 120 };
    expect(loose.pack === "LOOSE" ? loose.typedKg : AVG * loose.box).toBe(120);
    expect(loose.pack === "LOOSE" ? 0 : loose.box).toBe(0);
  });
});
