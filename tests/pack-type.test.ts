import { describe, expect, it } from "vitest";
import { crateCount, packsInCrates, PACK_LABELS, PACK_TYPES } from "@/lib/pack";

/**
 * Box, big box, loose.
 *
 * The merchant's own three words, and the distinction that matters is not the
 * size. A BIG_BOX holds the heavier fish — two kilos apiece — but it is still a
 * crate: it leaves on the truck and comes back like any other, so it belongs in
 * the box tally. LOOSE is fish too big to box at all, laid straight onto the
 * truck bed. There is no crate to send and none to return.
 *
 * Getting that wrong in the quiet direction is the danger: count a loose row as
 * zero crates and a day appears to balance while a third of the load was never
 * in a crate.
 */
describe("which packs are crates", () => {
  it("counts a box", () => {
    expect(packsInCrates("BOX")).toBe(true);
  });

  it("counts a big box — heavier fish, still a crate", () => {
    expect(packsInCrates("BIG_BOX")).toBe(true);
  });

  it("does not count loose", () => {
    expect(packsInCrates("LOOSE")).toBe(false);
  });

  it("offers exactly the three the merchant uses", () => {
    expect(PACK_TYPES).toEqual(["BOX", "BIG_BOX", "LOOSE"]);
    expect(PACK_TYPES.map((t) => PACK_LABELS[t])).toEqual([
      "Box",
      "Big Box",
      "Loose",
    ]);
  });
});

describe("the crates on a line", () => {
  it("is the box count on a boxed line", () => {
    expect(crateCount({ pack: "BOX", box: 40 })).toBe(40);
    expect(crateCount({ pack: "BIG_BOX", box: 12 })).toBe(12);
  });

  it("is none on a loose line, whatever number arrives with it", () => {
    // The form clears the count when the kind changes, but a stale figure must
    // never become crates that do not exist.
    expect(crateCount({ pack: "LOOSE", box: 25 })).toBe(0);
  });

  it("is none when no count was given at all", () => {
    expect(crateCount({ pack: "BOX", box: null })).toBe(0);
    expect(crateCount({ pack: "BOX" })).toBe(0);
  });
});

describe("a note carrying all three", () => {
  it("tallies only what is actually in crates", () => {
    const lines = [
      { pack: "BOX" as const, box: 100 },
      { pack: "BIG_BOX" as const, box: 20 },
      { pack: "LOOSE" as const, box: 0 },
    ];
    expect(lines.reduce((a, l) => a + crateCount(l), 0)).toBe(120);
  });
});
