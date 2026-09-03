import { describe, expect, it } from "vitest";

/**
 * A market bill is quoted PER BOX.
 *
 * The market's own paper says how many boxes it took, what one weighed, and
 * what it paid for each. So a row's weight is box × kg-per-box and its money is
 * box × rate-per-box — neither is a figure the clerk types independently of the
 * two beside it.
 *
 * Every other channel reweighs on arrival and pays by WEIGHT, which is why the
 * per-box rate is its own column rather than the per-kilo one reused. A figure
 * that means two things is a figure somebody eventually reads as the wrong one.
 *
 * A LOOSE row is the exception at both ends: fish too big to crate never went
 * into a box, so it has no per-box weight to multiply and no per-box price to
 * quote it at. It carries a typed weight and a per-kilo rate.
 */
const rowKg = (pack: string, box: number, kgPerBox: number, typedKg: number) =>
  pack === "LOOSE" ? typedKg : box * kgPerBox;

const rowAmount = (
  pack: string,
  box: number,
  kgPerBox: number,
  typedKg: number,
  ratePerBox: number,
  ratePerKg: number
) =>
  pack === "LOOSE"
    ? rowKg(pack, box, kgPerBox, typedKg) * ratePerKg
    : box * ratePerBox;

describe("a market row", () => {
  it("weighs its boxes times what one weighs", () => {
    expect(rowKg("BOX", 20, 25, 0)).toBe(500);
    expect(rowKg("BIG_BOX", 2, 100, 0)).toBe(200);
  });

  it("is paid for by the box, not by the kilo", () => {
    // 20 boxes at ₹1,500 a box is 30,000 — the weight does not enter into it.
    expect(rowAmount("BOX", 20, 25, 0, 1_500, 0)).toBe(30_000);
  });

  it("does not change its money when the weight is corrected", () => {
    // The kilos are a record of what went; the money is boxes × rate. A market
    // that revises what a box weighed still owes what it agreed per box.
    const a = rowAmount("BOX", 20, 25, 0, 1_500, 0);
    const b = rowAmount("BOX", 20, 22, 0, 1_500, 0);
    expect(a).toBe(b);
    expect(rowKg("BOX", 20, 25, 0)).not.toBe(rowKg("BOX", 20, 22, 0));
  });

  it("prices a loose row by weight, having no boxes", () => {
    // 500 kg of belt kandi at ₹30 — there is no box to quote a price against.
    expect(rowKg("LOOSE", 0, 0, 500)).toBe(500);
    expect(rowAmount("LOOSE", 0, 0, 500, 0, 30)).toBe(15_000);
  });

  it("foots a mixed bill the way the market's paper does", () => {
    // The real note: 20 boxes of bangdga, 500 kg loose bangde, 2 big boxes.
    const rows = [
      { pack: "BOX", box: 20, kgPerBox: 25, kg: 0, rb: 1_500, rk: 0 },
      { pack: "LOOSE", box: 0, kgPerBox: 0, kg: 500, rb: 0, rk: 30 },
      { pack: "BIG_BOX", box: 2, kgPerBox: 100, kg: 0, rb: 3_500, rk: 0 },
    ];
    const kg = rows.reduce((a, r) => a + rowKg(r.pack, r.box, r.kgPerBox, r.kg), 0);
    const money = rows.reduce(
      (a, r) => a + rowAmount(r.pack, r.box, r.kgPerBox, r.kg, r.rb, r.rk),
      0
    );
    expect(kg).toBe(1_200);
    expect(money).toBe(52_000);
    // Boxes still tally for the trip, loose carrying none.
    expect(
      rows.reduce((a, r) => a + (r.pack === "LOOSE" ? 0 : r.box), 0)
    ).toBe(22);
  });
});
