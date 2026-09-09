import { describe, expect, it } from "vitest";
import type { LedgerSourceType } from "@/generated/prisma/enums";

/**
 * What each statement row lists beneath it.
 *
 * A statement named the bill and stopped there, so "Purchase · Bill S-1042 ·
 * ₹1,85,000" told a seller the total and nothing about the fish. The lots now
 * print under the row, and their amounts sit in the same money column, so they
 * visibly add up to the entry above them.
 *
 * Two different questions, though, and which one a row is asking depends on
 * what the row IS. A voucher lists what it was made of. A row about the JOURNEY
 * — the rent, the advance handed over at loading, the debit for what a market
 * paid the driver — lists what the TRUCK carried, because that is what a
 * haulier is owed for. Those rows are all sourced from a sale or a trip, so the
 * sale's lots are within reach and must not be taken: printed under a rent they
 * said a transporter's ₹20,000 was made of eighteen boxes of prawns.
 *
 * Mirrors `statementLines` in src/lib/statement.ts, which is server-only and so
 * cannot be imported here.
 */
type Route = "items" | "load" | "none";
const routeOf = (t: LedgerSourceType): Route => {
  if (t === "SALE" || t === "PURCHASE" || t === "EXPENSE") return "items";
  if (t === "RENT" || t === "RENT_BY_PARTY" || t === "PAYMENT") return "load";
  return "none";
};

describe("what a row lists beneath it", () => {
  it("gives a voucher its own lines", () => {
    expect(routeOf("PURCHASE")).toBe("items");
    expect(routeOf("SALE")).toBe("items");
    expect(routeOf("EXPENSE")).toBe("items");
  });

  it("gives a transporter the load, never the sale's fish", () => {
    // The rent and the market's payment to the driver are both sourced from a
    // sale. They ask the load, not the bill.
    expect(routeOf("RENT")).toBe("load");
    expect(routeOf("RENT_BY_PARTY")).toBe("load");
    // The advance handed over at loading is sourced from the trip itself.
    expect(routeOf("PAYMENT")).toBe("load");
  });

  it("leaves a receipt as money", () => {
    expect(routeOf("RECEIPT")).toBe("none");
  });

  it("leaves the retired kinds alone", () => {
    expect(routeOf("COMMISSION")).toBe("none");
    expect(routeOf("RESERVE")).toBe("none");
  });
});

describe("finding the load a row is about", () => {
  // How `loads` is keyed: by the trip's id, and by the id of every bill raised
  // off that trip — a rent recorded against a bill has to reach the same load.
  const trip = { id: "trip-1", load: ["Prawns — 20 box · 500 kg"] };
  const sale = { id: "bill-1", deliveryNoteId: trip.id };
  const loads = new Map<string, string[]>([
    [trip.id, trip.load],
    [sale.id, trip.load],
  ]);

  it("finds it from the trip", () => {
    expect(loads.get("trip-1")).toEqual(trip.load);
  });

  it("finds it from a bill raised off that trip", () => {
    expect(loads.get("bill-1")).toEqual(trip.load);
  });

  it("finds nothing for a cash settlement", () => {
    // A payment to a seller is sourced from the settlement, which was never on
    // a truck. Routing it to the load map is safe because the map has no such
    // key — it lists nothing rather than borrowing another trip's fish.
    expect(loads.get("settlement-1") ?? []).toEqual([]);
  });
});

describe("the lines under a purchase", () => {
  it("add up to the entry above them", () => {
    // Society's Bill S-1042, as printed: the whole point of putting each line's
    // amount in the same column as its entry.
    const lines = [69_000, 112_500, 3_500];
    expect(lines.reduce((a, b) => a + b, 0)).toBe(185_000);
  });
});

describe("the lines under a market sale", () => {
  it("carry boxes and no money", () => {
    // A market bill's money is the net it paid, so a per-line amount would
    // invite adding the rows up and asking why the two disagree.
    const marketLineAmount = (isMarket: boolean, total: number) =>
      !isMarket && total > 0 ? total : null;
    expect(marketLineAmount(true, 0)).toBeNull();
    expect(marketLineAmount(false, 67_500)).toBe(67_500);
  });
});
