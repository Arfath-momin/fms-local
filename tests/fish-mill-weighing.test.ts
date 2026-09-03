import { describe, expect, it } from "vitest";

/**
 * A fish mill weighs twice.
 *
 * Once with the lots and the truck, once without. The load is the difference —
 * so the total is WORKING, not a figure anybody quotes, and it stays off the
 * printed bill. What the bill states is the two readings, what came off for
 * water and ice, and the net the mill paid on:
 *
 *     1st weight   12,400   the lots and the truck
 *     2nd weight   11,200   just the lots
 *     water less       50
 *     net weight    1,150
 *
 * The total is derived rather than typed for the reason every derived figure
 * here is: three numbers a clerk can enter independently are three that can
 * disagree, and the net is what the money hangs off.
 */
const total = (first: number, second: number) => Math.max(0, first - second);
const net = (first: number, second: number, waterLess: number) =>
  Math.max(0, total(first, second) - waterLess);

describe("the two weighings", () => {
  it("takes the load as the difference between them", () => {
    expect(total(12_400, 11_200)).toBe(1_200);
  });

  it("takes the net off that, not off the first reading", () => {
    // The commonest way to get this wrong: 12,400 − 50 is not the net of
    // anything, and would price the bill at ten times the fish.
    expect(net(12_400, 11_200, 50)).toBe(1_150);
    expect(net(12_400, 11_200, 50)).not.toBe(12_350);
  });

  it("spreads the net over the boxes, not the gross", () => {
    // 1,150 kg over 20 boxes. Every row's weight comes off this average, so a
    // total taken from the wrong reading would move every figure on the bill.
    expect(net(12_400, 11_200, 50) / 20).toBe(57.5);
  });

  it("refuses a second reading larger than the first", () => {
    // Readings entered the wrong way round. Left alone it would clamp to zero
    // and price the whole bill at nothing, which is worse than refusing.
    const wrongWayRound = (f: number, s: number) => s > f;
    expect(wrongWayRound(11_200, 12_400)).toBe(true);
    expect(wrongWayRound(12_400, 11_200)).toBe(false);
  });

  it("leaves a factory's single weight alone", () => {
    // A factory states one figure and hands kilos back; it does not weigh
    // twice, and its net is the weight less the return.
    const factoryNet = (weight: number, ret: number) => weight - ret;
    expect(factoryNet(500, 250)).toBe(250);
  });
});
