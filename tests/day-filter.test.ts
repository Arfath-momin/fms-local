import { describe, expect, it } from "vitest";
import { dayRange, parseListWindow } from "@/lib/paging";

/**
 * Picking one day without typing a range.
 *
 * A merchant after one day's delivery notes was setting the exact-dates form to
 * the same date twice — "1 Sept 2026 to 1 Sept 2026" — every time. The day is
 * the third field of a date and the picker already asked for the other two.
 */
describe("one day as a range", () => {
  it("opens and closes on the same date", () => {
    expect(dayRange(2026, 9, 1)).toEqual({ from: "2026-09-01", to: "2026-09-01" });
    expect(dayRange(2025, 8, 5)).toEqual({ from: "2025-08-05", to: "2025-08-05" });
  });

  it("pads a single-figure month and day", () => {
    expect(dayRange(2026, 1, 7)).toEqual({ from: "2026-01-07", to: "2026-01-07" });
  });

  it("takes the last day of a month, including a leap February", () => {
    expect(dayRange(2026, 2, 28)?.from).toBe("2026-02-28");
    expect(dayRange(2024, 2, 29)?.from).toBe("2024-02-29");
    expect(dayRange(2026, 8, 31)?.from).toBe("2026-08-31");
  });

  it("refuses a day the month does not have", () => {
    // 31 is always offered because the month can be changed after the day. A
    // range with nothing in it would read as "no vouchers that day", which is
    // a different and wrong answer.
    expect(dayRange(2026, 2, 31)).toBeNull();
    expect(dayRange(2026, 2, 29)).toBeNull();
    expect(dayRange(2026, 9, 31)).toBeNull();
    expect(dayRange(2026, 9, 0)).toBeNull();
    expect(dayRange(2026, 9, -1)).toBeNull();
  });
});

describe("the day in the URL", () => {
  it("narrows the month to that day", () => {
    const w = parseListWindow({ year: "2026", month: "9", day: "1" });
    expect([w.from, w.to]).toEqual(["2026-09-01", "2026-09-01"]);
  });

  it("falls back to the whole month for an impossible day", () => {
    const w = parseListWindow({ year: "2026", month: "2", day: "31" });
    expect([w.from, w.to]).toEqual(["2026-02-01", "2026-02-28"]);
  });

  it("leaves the month alone when no day is given", () => {
    // The behaviour every existing link relies on.
    const w = parseListWindow({ year: "2026", month: "9" });
    expect([w.from, w.to]).toEqual(["2026-09-01", "2026-09-30"]);
  });

  it("ignores a day with no month behind it", () => {
    // A day only means something inside a month; a year alone is still a year.
    const w = parseListWindow({ year: "2026", day: "5" });
    expect([w.from, w.to]).toEqual(["2026-01-01", "2026-12-31"]);
  });

  it("still lets an explicit range win", () => {
    // ?from=&to= is what every preset link and bookmark sends.
    const w = parseListWindow({ year: "2026", month: "9", day: "1", from: "2026-03-01", to: "2026-03-31" });
    expect([w.from, w.to]).toEqual(["2026-03-01", "2026-03-31"]);
  });
});
