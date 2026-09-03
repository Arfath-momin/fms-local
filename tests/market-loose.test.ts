import { describe, expect, it } from "vitest";
import { PACK_TYPES, packsInCrates } from "@/lib/pack";

/**
 * A market bill can carry LOOSE fish.
 *
 * Fish too big to crate goes straight onto the truck bed and has no boxes to
 * state. The market parse demanded a positive box count on EVERY row, so a trip
 * carrying one loose lot could not be billed at all: "Reset from trip" lays the
 * lot out, and the bill then refuses to save with
 *
 *     Boxes for "BELT KANDI" must be a positive whole number
 *
 * — about a row that correctly has none. Reproduced from a real trip, DN-00065,
 * which went out with 19 + 1 boxes of tarlie, 1 of kandi, and belt kandi and
 * chamman loose.
 */
const boxRequired = (pack: string, box: string) =>
  pack !== "LOOSE" && (!/^\d{1,6}$/.test(box) || Number(box) <= 0);

describe("boxes on a market line", () => {
  it("is required on a boxed row", () => {
    expect(boxRequired("BOX", "")).toBe(true);
    expect(boxRequired("BOX", "0")).toBe(true);
    expect(boxRequired("BIG_BOX", "")).toBe(true);
    expect(boxRequired("BOX", "20")).toBe(false);
  });

  it("is not required on a loose row", () => {
    // The row records WHICH fish went to that market. A market bill's money is
    // the net it paid, never a rate times a count, so nothing is lost.
    expect(boxRequired("LOOSE", "")).toBe(false);
    expect(boxRequired("LOOSE", "0")).toBe(false);
  });

  it("bills the trip that could not be billed", () => {
    const rows = [
      { pack: "BOX", box: "20", particular: "TARLIE" },
      { pack: "LOOSE", box: "", particular: "BELT KANDI" },
      { pack: "LOOSE", box: "", particular: "CHAMMAN" },
      { pack: "BOX", box: "1", particular: "KANDI" },
    ];
    expect(rows.filter((r) => boxRequired(r.pack, r.box))).toEqual([]);
    // And 21 boxes still reconcile against the trip, loose carrying none.
    expect(
      rows.reduce((a, r) => a + (r.pack === "LOOSE" ? 0 : Number(r.box)), 0)
    ).toBe(21);
  });

  it("agrees with the rule the rest of the system reads", () => {
    for (const p of PACK_TYPES) {
      expect(boxRequired(p, "")).toBe(packsInCrates(p));
    }
  });
});
