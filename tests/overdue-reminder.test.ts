import { describe, expect, it } from "vitest";
import { daysBetween, overdueReminder } from "@/lib/overdue-reminder";

describe("sale-party overdue reminders", () => {
  it("uses the three-day threshold label", () => {
    expect(overdueReminder(3).label).toBe("3 days ago");
  });

  it("uses increasing severity bands", () => {
    expect(overdueReminder(4).className).toContain("yellow");
    expect(overdueReminder(7).className).toContain("amber");
    expect(overdueReminder(15).className).toContain("orange");
    expect(overdueReminder(30, "05 Sept 2026").label).toBe("Since 05 Sept 2026");
  });

  it("keeps never-paid parties at the front of the queue", () => {
    expect(overdueReminder(null, undefined, true).label).toBe("Never paid");
    expect(overdueReminder(null).sortAge).toBe(Infinity);
  });

  it("counts calendar days between stored dates", () => {
    expect(daysBetween(new Date("2026-09-01T00:00:00.000Z"), new Date("2026-09-30T00:00:00.000Z"))).toBe(29);
  });
});