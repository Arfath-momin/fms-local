import { describe, expect, it } from "vitest";
import { matchOptions } from "@/app/(app)/combobox";

/**
 * Which row a merchant can reach by typing.
 *
 * A <select> is fine for five options and useless for eighty. The truck a rent
 * voucher is for, and the party a list is filtered to, both come from masters
 * that only grow — so what matters is that typing the part you remember gets
 * you there.
 */
const vehicles = [
  { id: "1", label: "KA20B5521 · Shetty Carriers", keywords: "Shetty Carriers" },
  { id: "2", label: "KA47A1234 · Ravi Transport", keywords: "Ravi Transport" },
  { id: "3", label: "KA20A9087 · Shetty Carriers", keywords: "Shetty Carriers" },
];

describe("finding a row by typing", () => {
  it("matches the start of a vehicle number", () => {
    expect(matchOptions(vehicles, "KA47A").map((o) => o.id)).toEqual(["2"]);
  });

  it("matches the middle of one, because nobody types from the left", () => {
    expect(matchOptions(vehicles, "9087").map((o) => o.id)).toEqual(["3"]);
  });

  it("ignores spacing on both sides", () => {
    // The reason this exists: one person writes KA20B5521 and the next writes
    // KA 20 B 5521, and a search that treated those as different strings would
    // fail on exactly the field it is for.
    expect(matchOptions(vehicles, "KA 20 B 5521").map((o) => o.id)).toEqual(["1"]);
    expect(matchOptions(vehicles, "ka20b").map((o) => o.id)).toEqual(["1"]);
  });

  it("ignores case", () => {
    expect(matchOptions(vehicles, "ka47a1234").map((o) => o.id)).toEqual(["2"]);
  });

  it("finds a lorry by its owner", () => {
    // For the merchant who remembers the man rather than the plate.
    expect(matchOptions(vehicles, "ravi").map((o) => o.id)).toEqual(["2"]);
    expect(matchOptions(vehicles, "shetty").map((o) => o.id)).toEqual(["1", "3"]);
  });

  it("returns nothing rather than everything when nothing matches", () => {
    // The failure that matters: a filter that silently ignores the query and
    // shows the whole list reads as "these all match".
    expect(matchOptions(vehicles, "KA99")).toEqual([]);
  });

  it("shows every option when nothing is typed and no limit is set", () => {
    expect(matchOptions(vehicles, "")).toHaveLength(3);
    expect(matchOptions(vehicles, "   ")).toHaveLength(3);
  });

  it("shows only the first few when a limit is set", () => {
    expect(matchOptions(vehicles, "", 2).map((o) => o.id)).toEqual(["1", "2"]);
    // …and the limit never truncates an actual search.
    expect(matchOptions(vehicles, "shetty", 1).map((o) => o.id)).toEqual(["1", "3"]);
  });

  it("searches party names the same way", () => {
    const parties = [
      { id: "a", label: "SHREE MATHA MARINE" },
      { id: "b", label: "City Market" },
      { id: "c", label: "Indo Fish Mill" },
    ];
    expect(matchOptions(parties, "shree matha").map((o) => o.id)).toEqual(["a"]);
    expect(matchOptions(parties, "citymarket").map((o) => o.id)).toEqual(["b"]);
    expect(matchOptions(parties, "fish").map((o) => o.id)).toEqual(["c"]);
  });
});
