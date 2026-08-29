// tallyTrip and deriveTripStatus are pure, but they live in @/lib/trip
// alongside the box-statement queries, so importing them pulls in the Prisma
// client — which now refuses to construct without a connection string rather
// than failing later at the first query. Same dotenv line as the integration
// tests; nothing here actually reaches the database.
import "dotenv/config";
import { describe, expect, it } from "vitest";
import type { SaleType } from "@/generated/prisma/enums";
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
  rentDeducted: number | null = null,
  /**
   * Which channel billed it. The kilo comparison only means anything when
   * every bill off a trip is a factory or mill bill — see `weighedOnly`.
   */
  type: SaleType = "FISH_MILL"
) => ({
  amount: D(amount),
  type,
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
    expect(deriveTripStatus(tally)).toBe("DISPATCHED");
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
    expect(deriveTripStatus(tally)).toBe("PART_BILLED");
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
    expect(deriveTripStatus(tally)).toBe("CLOSED");
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

    // This note recorded weight and no boxes, so there is nothing to tally
    // and the first bill closes it. A note that DOES carry boxes stays open
    // until they are accounted for, whatever it went out as — the returns a
    // factory rejects are sold off the same trip.
    expect(deriveTripStatus(tally)).toBe("CLOSED");
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
    expect(deriveTripStatus(tally)).toBe("DISPATCHED");
  });
});

describe("fish mill boxes", () => {
  it("takes a row's weight as the row's weight, not per box", () => {
    // A lot goes on the scale whole: 10 boxes, 450 kg. `qtyKg` IS that 450.
    //
    // It used to be the weight of a SINGLE box, to be multiplied up — and this
    // tally went on multiplying long after that changed. A real mill bill of
    // 5 boxes weighing 380 kg was counted as 1,900, so a 500 kg load reported
    // 1,400 kg rejected: more fish coming back than ever went out, valued at
    // minus eighty-seven thousand rupees.
    const trip = {
      channel: "FISH_MILL" as const,
      rentAmount: D(4_000),
      advancePaid: null,
      lines: [line(450, 10)],
      sales: [bill(25_000, [{ qtyKg: 450, box: 10 }])],
    };
    const tally = tallyTrip(trip);
    expect(tally.kgBilled.toNumber()).toBe(450);
    expect(tally.kgGap.toNumber()).toBe(0);
  });

  it("reproduces the trip that reported more fish back than went out", () => {
    // 25 boxes at 20 kg = 500 kg out. One mill bill of 5 boxes, 380 kg.
    const trip = {
      channel: null,
      rentAmount: D(4_000),
      advancePaid: D(5_000),
      lines: [line(500, 25)],
      sales: [bill(57_000, [{ qtyKg: 380, box: 5 }])],
    };
    const tally = tallyTrip(trip);
    expect(tally.kgBilled.toNumber()).toBe(380);
    // 120 kg short, not 1,400 over.
    expect(tally.kgGap.toNumber()).toBe(120);
    expect(tally.gapValue.greaterThan(0)).toBe(true);
  });
});

describe("a trip whose bills use different units", () => {
  it("will not compare kilos when a market bill is among them", () => {
    // A market bill is itemised in BOXES and carries no weight at all. Setting
    // its missing kilos against what went out reports the boxes the market
    // took as a rejection, in a unit the market never used.
    //
    // The real trip: 25 boxes out, a market bill for 20 of them and a mill
    // bill for 5. The panel showed "Kg accepted 1,900" against 500 kg out.
    const trip = {
      channel: null,
      rentAmount: D(4_000),
      advancePaid: D(5_000),
      lines: [line(500, 25)],
      sales: [
        bill(61_500, [{ qtyKg: 0, box: 20 }], null, "MARKET"),
        bill(57_000, [{ qtyKg: 380, box: 5 }], null, "FISH_MILL"),
      ],
    };
    const tally = tallyTrip(trip);

    expect(tally.weighedOnly).toBe(false);

    // The boxes DO reconcile, and they are the unit every channel itemises.
    expect(tally.boxesDispatched).toBe(25);
    expect(tally.boxesBilled).toBe(25);
  });

  it("compares kilos when every bill is weighed", () => {
    const trip = {
      channel: null,
      rentAmount: D(4_000),
      advancePaid: null,
      lines: [line(500, 25)],
      sales: [
        bill(30_000, [{ qtyKg: 200, box: 10 }], null, "FACTORY"),
        bill(27_000, [{ qtyKg: 180, box: 15 }], null, "FISH_MILL"),
      ],
    };
    const tally = tallyTrip(trip);
    expect(tally.weighedOnly).toBe(true);
    expect(tally.kgBilled.toNumber()).toBe(380);
  });

  it("compares nothing on a trip with no bills yet", () => {
    // Vacuously "every bill is weighed" is not a useful thing to report, so a
    // trip with nothing billed does not offer the comparison either.
    const trip = {
      channel: null,
      rentAmount: D(4_000),
      advancePaid: null,
      lines: [line(500, 25)],
      sales: [],
    };
    expect(tallyTrip(trip).weighedOnly).toBe(false);
  });
});
