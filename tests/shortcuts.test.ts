import { describe, expect, it } from "vitest";
import { SHORTCUTS, newVoucherHref } from "@/lib/shortcuts";

/**
 * The keyboard map.
 *
 * Alt rather than Ctrl throughout: browsers reserve Ctrl+N, Ctrl+T, Ctrl+W and
 * Ctrl+L outright and a page cannot intercept them, while Ctrl+P and Ctrl+S can
 * only be taken by hijacking print and save — the two letters a vouchers app
 * most wants. Alt leaves every natural letter free.
 */
describe("the shortcut map", () => {
  it("binds no combination the browser will not give us", () => {
    const reserved = ["ctrl+n", "ctrl+t", "ctrl+w", "ctrl+l", "ctrl+p", "ctrl+s"];
    for (const s of SHORTCUTS) {
      expect(reserved).not.toContain(s.combo.toLowerCase());
      expect(s.combo.startsWith("alt+")).toBe(true);
    }
  });

  it("gives every key one meaning", () => {
    const combos = SHORTCUTS.map((s) => s.combo);
    expect(new Set(combos).size).toBe(combos.length);
  });

  it("uses the first letter of what it opens, so it can be guessed", () => {
    // The whole reason for choosing Alt. If a shortcut ever stops matching its
    // word, it has to be memorised instead — and a shortcut nobody remembers is
    // a shortcut nobody uses.
    for (const s of SHORTCUTS) {
      const letter = s.combo.replace("alt+", "");
      expect(s.description.toLowerCase().startsWith(letter)).toBe(true);
    }
  });

  it("keeps its label and its binding in step", () => {
    for (const s of SHORTCUTS) {
      expect(s.label.toLowerCase()).toBe(s.combo.replace("+", "+"));
    }
  });
});

describe("Alt+N", () => {
  it("raises the voucher belonging to the list you are on", () => {
    expect(newVoucherHref("/vouchers/sales")).toBe("/vouchers/sales/new");
    expect(newVoucherHref("/vouchers/purchases")).toBe("/vouchers/purchases/new");
  });

  it("does nothing on a screen with nothing to raise", () => {
    expect(newVoucherHref("/ledgers")).toBeNull();
    expect(newVoucherHref("/reports/profit")).toBeNull();
    expect(newVoucherHref("/")).toBeNull();
  });

  it("does nothing while reading one voucher", () => {
    // From a bill the merchant is reading, "new" is more likely a slip than an
    // intention.
    expect(newVoucherHref("/vouchers/sales/abc-123")).toBeNull();
    expect(newVoucherHref("/vouchers/sales/new")).toBeNull();
  });

  it("ignores a trailing slash", () => {
    expect(newVoucherHref("/vouchers/sales/")).toBe("/vouchers/sales/new");
  });
});
