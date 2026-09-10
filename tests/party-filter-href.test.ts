import { describe, expect, it } from "vitest";
import { partyFilterHref } from "@/lib/list-href";

/**
 * Where the party filter goes when a party is chosen.
 *
 * The bug this pins: choosing a party called requestSubmit() on the form in the
 * same handler that set the state behind the hidden field, so the form posted
 * the value that field held BEFORE the choice — on a first pick, the empty
 * string. The URL came out as
 *
 *   /vouchers/deliveries?from=2026-09-01&to=2026-09-30&party=
 *
 * and the list filtered to nobody. The href is now built from the id itself,
 * which is known at that instant and owes nothing to React having re-rendered.
 */
const w = { from: "2026-09-01", to: "2026-09-30" };

describe("the party filter's destination", () => {
  it("carries the party that was just chosen", () => {
    expect(partyFilterHref("/vouchers/deliveries", w, "abc-123")).toBe(
      "/vouchers/deliveries?from=2026-09-01&to=2026-09-30&party=abc-123"
    );
  });

  it("keeps the window, so the two controls compose", () => {
    // A single day picked first must survive choosing a party second.
    const day = { from: "2026-08-30", to: "2026-08-30" };
    expect(partyFilterHref("/vouchers/deliveries", day, "p1")).toBe(
      "/vouchers/deliveries?from=2026-08-30&to=2026-08-30&party=p1"
    );
  });

  it("drops the key entirely for Everyone", () => {
    // Never "?party=" — that was the shape of the bug, and a URL should say
    // what it means.
    expect(partyFilterHref("/vouchers/sales", w, "")).toBe(
      "/vouchers/sales?from=2026-09-01&to=2026-09-30"
    );
  });

  it("escapes what it puts in the query", () => {
    expect(partyFilterHref("/vouchers/sales", w, "a b&c")).toContain(
      "party=a+b%26c"
    );
  });
});
