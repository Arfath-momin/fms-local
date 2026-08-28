// @/lib/trip pulls in the Prisma client alongside its pure helpers, and that
// now refuses to construct without a connection string. Nothing here reaches
// the database.
import "dotenv/config";
import { describe, expect, it } from "vitest";
import { deriveTripStatus } from "@/lib/trip";
import { Prisma } from "@/generated/prisma/client";
import { saleLineKgPerBox, saleLineTotalKg } from "@/lib/sale";

const D = (n: number) => new Prisma.Decimal(n);
const tally = (dispatched: number, billed: number, bills: number) => ({
  boxesDispatched: dispatched,
  boxesBilled: billed,
  kgDispatched: D(0),
  kgBilled: D(0),
  kgGap: D(0),
  gapValue: D(0),
  billCount: bills,
  billedAmount: D(0),
});

/**
 * One journey, several bills, and the boxes have to add up.
 *
 * A trip used to CLOSE on its first bill unless it went out as MARKET, on the
 * assumption that the whole load went to one buyer. That is not the day the
 * merchant actually has: the truck goes to the factory, the factory rejects
 * part of the load, and the returns are sold at a market or locally on the way
 * home. The trip vanished from the picker the moment the factory bill landed,
 * so the boxes that came back had nowhere to be accounted for — and a LOCAL
 * bill was offered no trip at all, ever.
 */
describe("a trip closes when its boxes are accounted for", () => {
  it("stays open while boxes remain, whatever it went out as", () => {
    // 150 boxes to the factory; the factory took 120 and rejected 30.
    expect(deriveTripStatus(tally(150, 120, 1))).toBe("PART_BILLED");
  });

  it("closes once the returns are billed too", () => {
    // The 30 rejected boxes sold locally on the way home, off the same trip.
    expect(deriveTripStatus(tally(150, 150, 2))).toBe("CLOSED");
  });

  it("is DISPATCHED until something is billed", () => {
    expect(deriveTripStatus(tally(150, 0, 0))).toBe("DISPATCHED");
  });

  it("closes on a split box rather than hanging on one too many", () => {
    // A buyer splitting a box bills 151 against 150. The trip is still fully
    // accounted for, so this is >= and not ===.
    expect(deriveTripStatus(tally(150, 151, 2))).toBe("CLOSED");
  });

  it("closes on the first bill when the note recorded no boxes", () => {
    // Weight-only notes have nothing to tally. Holding them open forever would
    // fill the picker with journeys nobody can ever finish.
    expect(deriveTripStatus(tally(0, 0, 1))).toBe("CLOSED");
  });
});

describe("a sale line's weight is the line's own", () => {
  it("takes the lot as weighed, not one box multiplied up", () => {
    // 150 boxes went on the scale together and came to 4,500 kg. That is what
    // is typed, and what the rate is charged on.
    expect(saleLineTotalKg({ qtyKg: 4_500, box: 150 })).toBe(4_500);
  });

  it("derives the per-box average from the two observed figures", () => {
    expect(saleLineKgPerBox({ qtyKg: 4_500, box: 150 })).toBe(30);
  });

  it("has no average to give when the line carries no boxes", () => {
    expect(saleLineKgPerBox({ qtyKg: 4_500, box: 0 })).toBe(0);
    expect(saleLineKgPerBox({ qtyKg: 4_500, box: null })).toBe(0);
  });

  it("keeps the money exact where an average would not", () => {
    // The reason the column had to move. 4,400 over 150 boxes is 29.333, and a
    // per-box figure stored to three places multiplies back to 4,399.95 — five
    // kilos of fish lost to rounding, on every line, forever.
    const perBoxRounded = Number((4_400 / 150).toFixed(3));
    expect(perBoxRounded * 150).not.toBe(4_400);
    expect(saleLineTotalKg({ qtyKg: 4_400, box: 150 })).toBe(4_400);
  });
});
