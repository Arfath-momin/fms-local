// tallyTrip and deriveTripStatus are pure, but they live in @/lib/trip
// alongside the box-statement queries, so importing them pulls in the Prisma
// client — which now refuses to construct without a connection string rather
// than failing later at the first query. Same dotenv line as the integration
// tests; nothing here actually reaches the database.
import "dotenv/config";
import { describe, expect, it } from "vitest";
import { Prisma } from "@/generated/prisma/client";
import { deriveTripStatus, tallyTrip } from "@/lib/trip";

/**
 * Phase 2's gate, from BFM_REBUILD_PLAN:
 *
 *   "a three-market trip with 100 boxes tallies to 100 and closes;
 *    a factory trip with a 40 kg rejection shows the gap and its value"
 *
 * Pure functions, so the arithmetic is checkable without a database — the
 * status transitions and the rejection valuation are the two things a later
 * phase could quietly break.
 */
const D = (n: number) => new Prisma.Decimal(n);
const line = (kg: number, box: number) => ({ kg: D(kg), box });
const bill = (
  amount: number,
  lines: { qtyKg: number; box: number | null }[],
  rentDeducted: number | null = null
) => ({
  amount: D(amount),
  rentDeducted: rentDeducted === null ? null : D(rentDeducted),
  lines: lines.map((l) => ({ qtyKg: D(l.qtyKg), box: l.box })),
});

describe("market trip: three stops, 100 boxes", () => {
  const dispatched = [line(3_000, 100)];

  it("is DISPATCHED with no bills back", () => {
    const trip = {
      channel: "MARKET" as const,
      rentAmount: D(20_000),
      advancePaid: D(5_000),
      lines: dispatched,
      sales: [],
    };
    const tally = tallyTrip(trip);
    expect(tally.boxesDispatched).toBe(100);
    expect(tally.boxesBilled).toBe(0);
    expect(deriveTripStatus("MARKET", tally)).toBe("DISPATCHED");
  });

  it("is PART_BILLED while boxes are still out", () => {
    const trip = {
      channel: "MARKET" as const,
      rentAmount: D(20_000),
      advancePaid: D(5_000),
      lines: dispatched,
      sales: [
        bill(60_000, [{ qtyKg: 1_200, box: 40 }]),
        bill(45_000, [{ qtyKg: 900, box: 30 }]),
      ],
    };
    const tally = tallyTrip(trip);
    expect(tally.boxesBilled).toBe(70);
    expect(deriveTripStatus("MARKET", tally)).toBe("PART_BILLED");
  });

  it("tallies to 100 and CLOSES on the third bill", () => {
    const trip = {
      channel: "MARKET" as const,
      rentAmount: D(20_000),
      advancePaid: D(5_000),
      lines: dispatched,
      sales: [
        bill(60_000, [{ qtyKg: 1_200, box: 40 }]),
        bill(45_000, [{ qtyKg: 900, box: 30 }]),
        // The last stop carries the rent balance: 20,000 less the 5,000
        // advance already handed to the driver.
        bill(43_400, [{ qtyKg: 900, box: 30 }], 15_000),
      ],
    };
    const tally = tallyTrip(trip);
    expect(tally.boxesBilled).toBe(100);
    expect(tally.boxesDispatched).toBe(100);
    expect(deriveTripStatus("MARKET", tally)).toBe("CLOSED");
  });

});

describe("factory trip: a 40 kg rejection", () => {
  it("shows the gap and values it at what the load actually fetched", () => {
    const trip = {
      channel: "FACTORY" as const,
      rentAmount: D(8_000),
      advancePaid: null,
      lines: [line(1_000, 0)],
      // The factory reweighed and accepted 960 kg, paying ₹96,000 — ₹100/kg.
      sales: [bill(96_000, [{ qtyKg: 960, box: null }])],
    };
    const tally = tallyTrip(trip);

    expect(tally.kgDispatched.toNumber()).toBe(1_000);
    expect(tally.kgBilled.toNumber()).toBe(960);
    expect(tally.kgGap.toNumber()).toBe(40);
    // 40 kg at the ₹100/kg the accepted fish actually fetched.
    expect(tally.gapValue.toNumber()).toBe(4_000);

    // A factory trip closes on its first bill: the whole load went to one
    // buyer, so the gap is a fact about that bill, not an outstanding delivery.
    expect(deriveTripStatus("FACTORY", tally)).toBe("CLOSED");
  });

  it("values nothing when nothing has been billed", () => {
    const trip = {
      channel: "FACTORY" as const,
      rentAmount: D(8_000),
      advancePaid: null,
      lines: [line(1_000, 0)],
      sales: [],
    };
    const tally = tallyTrip(trip);
    // No rate to value the gap at yet — better zero than a divide by zero.
    expect(tally.gapValue.toNumber()).toBe(0);
    expect(deriveTripStatus("FACTORY", tally)).toBe("DISPATCHED");
  });
});

describe("fish mill boxes", () => {
  it("counts a box's weight per box, not once for the row", () => {
    // 10 boxes of 45 kg each is 450 kg sold, and the money follows the 450.
    const trip = {
      channel: "FISH_MILL" as const,
      rentAmount: D(4_000),
      advancePaid: null,
      lines: [line(450, 10)],
      sales: [bill(25_000, [{ qtyKg: 45, box: 10 }])],
    };
    const tally = tallyTrip(trip);
    expect(tally.kgBilled.toNumber()).toBe(450);
    expect(tally.kgGap.toNumber()).toBe(0);
  });
});
