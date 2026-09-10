import { describe, expect, it } from "vitest";

/**
 * A factory bill graded by weight instead of counted in boxes.
 *
 * One particular arrives as one lot — 200 boxes of bangda — and the factory
 * grades it into sizes and pays a different rate for each. Nobody can say how
 * many of those 200 boxes were the 8/10 and how many the 4/5; the paper gives
 * kilos per grade. So a graded row states its own weight and carries no boxes,
 * and the boxes stay a bill-level figure taken from the delivery note.
 *
 * Mirrors the arithmetic in the FACTORY branch of the sale action and in
 * sale-form, neither of which can be imported here.
 */
const rows = [
  { particular: "Bangdga", countLabel: "8/10", kg: 1000, rate: 240 },
  { particular: "Bangdga", countLabel: "4/5", kg: 500, rate: 500 },
];
const rowTotal = (r: { kg: number; rate: number }) => r.kg * r.rate;
const netWeight = (rs: typeof rows) => rs.reduce((a, r) => a + r.kg, 0);
const amount = (rs: typeof rows) => rs.reduce((a, r) => a + rowTotal(r), 0);
const grossWeight = (rs: typeof rows, returnKg: number) => netWeight(rs) + returnKg;
const avgKgPerBox = (rs: typeof rows, totalBox: number) =>
  totalBox > 0 ? netWeight(rs) / totalBox : 0;

describe("a graded factory bill", () => {
  it("prices each grade at its own rate", () => {
    expect(rowTotal(rows[0])).toBe(240_000);
    expect(rowTotal(rows[1])).toBe(250_000);
  });

  it("takes its net weight from the rows, not from a typed figure", () => {
    // The rows ARE the net: the factory weighed each grade and paid on it.
    // Typing it again would be a second figure free to disagree with them.
    expect(netWeight(rows)).toBe(1500);
  });

  it("takes its amount from the rows", () => {
    expect(amount(rows)).toBe(490_000);
  });

  it("reaches the gross from the net and the return", () => {
    // What they kept plus what they handed back — the same arithmetic the
    // boxed layout already used, read the same way round.
    expect(grossWeight(rows, 56.7)).toBeCloseTo(1556.7, 3);
    expect(grossWeight(rows, 0)).toBe(1500);
  });

  it("works the average out from the rows and the note's boxes", () => {
    // The other way round from the boxed layout, where the average came off
    // the slip and was spread across each row's boxes.
    expect(avgKgPerBox(rows, 200)).toBe(7.5);
    // No boxes on the note yet is not a divide-by-zero.
    expect(avgKgPerBox(rows, 0)).toBe(0);
  });

  it("keeps the grade as text, never as a number", () => {
    // "8/10" is a range and its two halves mean nothing apart. Parsed as a
    // number it is 0.8, which is not a size anybody would recognise.
    expect(rows.map((r) => r.countLabel)).toEqual(["8/10", "4/5"]);
    expect(typeof rows[0].countLabel).toBe("string");
  });
});

describe("which layout a factory bill opens on", () => {
  // The rule that keeps old bills exactly as they were.
  const layout = (isNew: boolean, lines: { box: number | null }[]) => {
    if (!isNew && lines.length === 0) return "lump sum";
    if (!isNew && lines.some((l) => Number(l.box) > 0)) return "boxed";
    return "graded";
  };

  it("keeps a bill entered before itemisation on its single amount", () => {
    expect(layout(false, [])).toBe("lump sum");
  });

  it("keeps a bill entered in boxes on the boxed layout", () => {
    // Its rows carry boxes and take their weight from the slip's average.
    expect(layout(false, [{ box: 30 }])).toBe("boxed");
    expect(layout(false, [{ box: 20 }, { box: 11 }])).toBe("boxed");
  });

  it("gives every new bill the graded layout", () => {
    expect(layout(true, [])).toBe("graded");
  });

  it("re-opens a graded bill as graded", () => {
    expect(layout(false, [{ box: null }, { box: null }])).toBe("graded");
  });
});
