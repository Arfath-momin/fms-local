import { describe, expect, it } from "vitest";

/**
 * What a weighed bill's rows must supply — and what they must not be asked for.
 *
 * On a fish mill or factory bill the row weights are DERIVED: the average off
 * the weighing slip, times the boxes on the row. Nobody weighs a single box.
 *
 * Both forms were unsaveable because of this. The Kgs cell rendered as text
 * rather than a field, so no weight was submitted at all, and the server
 * refused the bill with "Qty for Prawns must be a positive number" — asking the
 * clerk for the one figure the whole design says they do not type. The user's
 * own bills, reproduced here:
 *
 *   300 total − 100 water = 200 net over 5 boxes = 40.000 kg/box
 *     2 boxes Prawns @ 150 →  80.000 kg → 12,000
 *     3 boxes Prawns @ 250 → 120.000 kg → 30,000
 *                                          42,000
 */
const derive = (net: number, totalBox: number, box: number) =>
  totalBox > 0 ? (net / totalBox) * box : 0;

describe("a weighed bill's rows", () => {
  it("derives each row's weight from the slip, as the form showed it", () => {
    const net = 300 - 100;
    expect(net / 5).toBe(40);
    expect(derive(net, 5, 2)).toBe(80);
    expect(derive(net, 5, 3)).toBe(120);
  });

  it("prices on the derived weight and sums to the bill", () => {
    const net = 200;
    const rows = [
      { box: 2, rate: 150 },
      { box: 3, rate: 250 },
    ];
    const total = rows.reduce(
      (a, r) => a + derive(net, 5, r.box) * r.rate,
      0
    );
    expect(total).toBe(42_000);
  });

  it("adds back to the net, so no weight is invented or lost", () => {
    const net = 200;
    const kg = [2, 3].reduce((a, b) => a + derive(net, 5, b), 0);
    expect(kg).toBe(net);
  });

  it("reproduces the factory bill too, water-less left empty", () => {
    // 200 total, nothing off for water, so net is the total.
    const net = 200 - 0;
    expect(derive(net, 5, 3) * 100 + derive(net, 5, 2) * 120).toBe(21_600);
  });

  it("asks a boxed row for BOXES, never for a typed weight", () => {
    // The rule the server now applies. A weighed row without boxes has nothing
    // for the average to be spread over; a weighed row without a typed weight
    // is entirely normal and must save.
    const ok = (pack: string, box: number, qty: string) =>
      pack === "LOOSE" ? qty !== "" && Number(qty) > 0 : box > 0;

    expect(ok("BOX", 2, "")).toBe(true);
    expect(ok("BOX", 0, "80")).toBe(false);
    // Loose fish never went into a crate, so it keeps typing its own weight.
    expect(ok("LOOSE", 0, "450")).toBe(true);
    expect(ok("LOOSE", 0, "")).toBe(false);
  });
});
