import { describe, expect, it } from "vitest";

/**
 * A factory states what it ACCEPTED and what it handed back.
 *
 * So the net is typed and the total is the two added — the other way round from
 * a fish mill, whose slip gives two weighbridge readings and leaves the net to
 * be worked out.
 *
 * It read the other way round: total typed, net derived. That asked the clerk
 * for a figure the factory's paper does not give them, so they were subtracting
 * the return from the net in their head and typing the answer — arithmetic the
 * form should be doing, on the field every row's weight and the whole bill's
 * money hangs off.
 */
const factoryTotal = (net: number, ret: number) => net + ret;
const millTotal = (first: number, second: number) => Math.max(0, first - second);
const millNet = (first: number, second: number, water: number) =>
  Math.max(0, millTotal(first, second) - water);

describe("a factory bill's weights", () => {
  it("adds the return back to reach what arrived", () => {
    // The bill reported: 714 accepted, 56.7 handed back.
    expect(factoryTotal(714, 56.7)).toBeCloseTo(770.7, 3);
  });

  it("leaves the net exactly as typed", () => {
    // The net is what the factory paid on. Nothing may round or re-derive it.
    const net = 714;
    expect(factoryTotal(net, 56.7) - 56.7).toBeCloseTo(net, 3);
  });

  it("is the total when nothing came back", () => {
    expect(factoryTotal(500, 0)).toBe(500);
  });

  it("spreads the net over the boxes, not the total", () => {
    // 714 over 31 boxes. Using 770.7 would move every row's weight and so the
    // money on every line.
    expect(714 / 31).toBeCloseTo(23.032, 3);
    expect(770.7 / 31).not.toBeCloseTo(23.032, 3);
  });
});

describe("a mill bill's weights, which run the other way", () => {
  it("takes the load as the gap between the two weighings", () => {
    expect(millTotal(12_400, 11_200)).toBe(1_200);
  });

  it("derives the net from that, not from a typed figure", () => {
    expect(millNet(12_400, 11_200, 50)).toBe(1_150);
  });

  it("never adds the water back the way a factory adds its return", () => {
    // The two channels are mirror images and it would be easy to copy one rule
    // onto the other. Water taken off a mill's load is gone; a factory's return
    // is fish that came back and was part of what arrived.
    expect(millNet(12_400, 11_200, 50)).not.toBe(millTotal(12_400, 11_200) + 50);
  });
});
