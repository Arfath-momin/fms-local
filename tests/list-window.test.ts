import { describe, expect, it } from "vitest";
import {
  activePreset,
  monthRange,
  parseListWindow,
  weekRange,
  yearRange,
} from "@/lib/paging";

/**
 * The periods a merchant names out loud.
 *
 * Every list opened on the current month and offered nothing but two date
 * fields, so looking at last week meant typing two dates — on every screen,
 * every time. Reported as the thing that most slows entry down.
 *
 * The URL contract is ADDITIVE: ?from=&to= means exactly what it always did, so
 * every link already shared or bookmarked still resolves to the same list.
 */
describe("a named month", () => {
  it("covers the whole month", () => {
    expect(monthRange(2026, 7)).toEqual({ from: "2026-07-01", to: "2026-07-31" });
  });

  it("knows how long February is, leap year or not", () => {
    expect(monthRange(2026, 2).to).toBe("2026-02-28");
    expect(monthRange(2028, 2).to).toBe("2028-02-29");
  });

  it("covers the short months exactly", () => {
    for (const m of [4, 6, 9, 11]) {
      expect(monthRange(2026, m).to.slice(-2)).toBe("30");
    }
  });

  it("does not spill into the next month", () => {
    expect(monthRange(2026, 12)).toEqual({
      from: "2026-12-01",
      to: "2026-12-31",
    });
  });
});

describe("a named year", () => {
  it("runs January to December", () => {
    expect(yearRange(2026)).toEqual({ from: "2026-01-01", to: "2026-12-31" });
  });
});

describe("this week", () => {
  it("is seven days, Monday to Sunday", () => {
    const w = weekRange();
    const from = new Date(`${w.from}T00:00:00.000Z`);
    const to = new Date(`${w.to}T00:00:00.000Z`);
    expect(from.getUTCDay()).toBe(1);
    expect(to.getUTCDay()).toBe(0);
    expect((to.getTime() - from.getTime()) / 86_400_000).toBe(6);
  });
});

describe("reading a list's window off the URL", () => {
  it("still honours from and to, exactly as before", () => {
    const w = parseListWindow({ from: "2026-03-04", to: "2026-03-09" });
    expect(w.from).toBe("2026-03-04");
    expect(w.to).toBe("2026-03-09");
  });

  it("takes a month and a year", () => {
    const w = parseListWindow({ year: "2026", month: "7" });
    expect(w.from).toBe("2026-07-01");
    expect(w.to).toBe("2026-07-31");
  });

  it("takes a year on its own as the whole year", () => {
    const w = parseListWindow({ year: "2026" });
    expect(w.from).toBe("2026-01-01");
    expect(w.to).toBe("2026-12-31");
  });

  it("falls back to this month rather than erroring on nonsense", () => {
    // A hand-edited URL should show a list, not a stack trace.
    const bad = parseListWindow({ year: "abcd", month: "99" });
    const none = parseListWindow({});
    expect(bad.from).toBe(none.from);
    expect(bad.to).toBe(none.to);
  });

  it("ignores a month outside the calendar", () => {
    expect(parseListWindow({ year: "2026", month: "13" }).from).toBe("2026-01-01");
    expect(parseListWindow({ year: "2026", month: "0" }).from).toBe("2026-01-01");
  });

  it("lets an explicit range win over a month", () => {
    // Only one control ever submits, so these cannot really arrive together —
    // but if a URL is edited by hand, the more specific one is what was meant.
    const w = parseListWindow({ year: "2026", month: "7", from: "2026-02-01", to: "2026-02-05" });
    expect(w.from).toBe("2026-02-01");
  });

  it("defaults to this month, which is what it always did", () => {
    const w = parseListWindow({});
    expect(activePreset(w)).toBe("month");
  });
});

describe("which preset is showing", () => {
  it("recognises a range that matches one, however it was reached", () => {
    // Compared by the dates rather than remembered in the URL, so a link
    // shared between two people means the same thing to both.
    expect(activePreset(monthRange(2026, 7))).toBe(
      parseListWindow({}).from === monthRange(2026, 7).from ? "month" : null
    );
    expect(activePreset(weekRange())).toBe("week");
  });

  it("says none for a range that is nobody's preset", () => {
    expect(activePreset({ from: "2026-03-04", to: "2026-03-09" })).toBeNull();
  });
});
