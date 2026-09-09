import { describe, expect, it } from "vitest";
import type { PurchaseType } from "@/generated/prisma/enums";
import { groupPurchaseParties } from "@/lib/purchase";

/**
 * How the purchase-party ledger list is filed.
 *
 * It was one A-to-Z column of every seller, so "who am I still to pay for
 * local fish" meant reading the whole list and picking the names out by eye.
 * Society and KFDC head it as the single accounts they are; everyone else sits
 * under the kind they sell through.
 */
const p = (name: string, purchaseKind: PurchaseType | null) => ({
  name,
  purchaseKind,
});
const STANDING = ["Society", "KFDC"];

describe("filing purchase parties", () => {
  it("heads the list with the standing accounts, unlabelled", () => {
    const g = groupPurchaseParties(
      [p("Society", "SOCIETY"), p("KFDC", "KFDC"), p("Ravi", "PRIVATE")],
      STANDING
    );
    expect(g[0].label).toBeNull();
    expect(g[0].rows.map((r) => r.name)).toEqual(["Society", "KFDC"]);
  });

  it("gives private and local a section each, private first", () => {
    const g = groupPurchaseParties(
      [p("Raju", "LOCAL"), p("Ravi", "PRIVATE"), p("Asha", "LOCAL")],
      STANDING
    );
    expect(g.map((s) => s.label)).toEqual(["Private", "Local"]);
    expect(g[1].rows.map((r) => r.name)).toEqual(["Raju", "Asha"]);
  });

  it("keeps the order it was handed inside a section", () => {
    // The page sorts alphabetically before grouping; filing must not reshuffle.
    const g = groupPurchaseParties(
      [p("Asha", "LOCAL"), p("Bela", "LOCAL"), p("Chandra", "LOCAL")],
      STANDING
    );
    expect(g[0].rows.map((r) => r.name)).toEqual(["Asha", "Bela", "Chandra"]);
  });

  it("prints no heading for a kind nobody sells through", () => {
    // A centre that only ever buys from the Society must not show four empty
    // sections.
    const g = groupPurchaseParties([p("Society", "SOCIETY")], STANDING);
    expect(g).toHaveLength(1);
    expect(g[0].label).toBeNull();
  });

  it("still shows a seller whose kind was never filled in", () => {
    // purchaseKind is null on parties that predate the field. A seller dropped
    // from this list is money owed that nobody can see.
    const g = groupPurchaseParties([p("Ravi", "PRIVATE"), p("Old Man", null)], STANDING);
    expect(g.map((s) => s.label)).toEqual(["Private", "Not yet filed"]);
    expect(g[1].rows.map((r) => r.name)).toEqual(["Old Man"]);
  });

  it("puts every party in exactly one section, whatever the mix", () => {
    // The invariant the whole thing rests on.
    const rows = [
      p("Society", "SOCIETY"), p("KFDC", "KFDC"), p("Ravi", "PRIVATE"),
      p("Raju", "LOCAL"), p("Old Man", null), p("Sea Co", "SOCIETY"),
    ];
    const seen = groupPurchaseParties(rows, STANDING).flatMap((s) => s.rows);
    expect(seen).toHaveLength(rows.length);
    expect(new Set(seen.map((r) => r.name)).size).toBe(rows.length);
  });

  it("files a society-kind party that is not THE Society account", () => {
    // Only the two standing names head the list; anything else with that kind
    // belongs in the kind's own section, not silently beside them.
    const g = groupPurchaseParties([p("Society", "SOCIETY"), p("Sea Co", "SOCIETY")], STANDING);
    expect(g.map((s) => s.label)).toEqual([null, "Society"]);
    expect(g[1].rows.map((r) => r.name)).toEqual(["Sea Co"]);
  });
});
