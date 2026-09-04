import { describe, expect, it } from "vitest";
import { matchTrips, type PickableTrip } from "@/app/(app)/vouchers/trip-picker";

/**
 * Finding a trip by typing part of its number.
 *
 * The picker was a plain list of every open trip, sorted by BUYING DAY. That
 * works until a delivery note is raised today against an old purchase: it sorts
 * to the bottom of forty, and the merchant who entered it two minutes ago
 * cannot find it. Reported exactly that way.
 */
const trip = (billNo: string, date: string, vehicle = "KA20A9087"): PickableTrip => ({
  id: billNo,
  billNo,
  date,
  vehicleNumber: vehicle,
  boxesDispatched: 10,
});

// Newest buying day first, as openTrips returns them.
const TRIPS = [
  trip("DN-00092", "2026-09-04"),
  trip("DN-00091", "2026-09-03"),
  trip("DN-00090", "2026-09-02"),
  trip("DN-00089", "2026-09-01"),
  trip("DN-00087", "2026-08-31"),
  trip("DN-00086", "2026-08-30"),
  // Entered today, against an old buying day — so it sorts to the bottom.
  trip("DN-00088", "2026-07-14", "KA47A5307"),
];

describe("finding a trip", () => {
  it("offers the five most recent when nothing is typed", () => {
    expect(matchTrips(TRIPS, "").map((t) => t.billNo)).toEqual([
      "DN-00092",
      "DN-00091",
      "DN-00090",
      "DN-00089",
      "DN-00087",
    ]);
  });

  it("finds the one that sorts to the bottom, by its number", () => {
    // The whole reason this exists. DN-00088 is last in the list and would
    // never be among the recent five.
    expect(matchTrips(TRIPS, "88").map((t) => t.billNo)).toEqual(["DN-00088"]);
  });

  it("does not make the merchant type the leading zeros", () => {
    // Nobody says "DN zero zero zero eight eight" — they say eighty-eight.
    expect(matchTrips(TRIPS, "88")).toHaveLength(1);
    expect(matchTrips(TRIPS, "dn-00088")).toHaveLength(1);
    expect(matchTrips(TRIPS, "DN-00088")).toHaveLength(1);
  });

  it("finds it by the truck, for somebody who remembers that instead", () => {
    expect(matchTrips(TRIPS, "KA47").map((t) => t.billNo)).toEqual(["DN-00088"]);
    expect(matchTrips(TRIPS, "ka47").map((t) => t.billNo)).toEqual(["DN-00088"]);
  });

  it("finds it by its buying day", () => {
    expect(matchTrips(TRIPS, "2026-07").map((t) => t.billNo)).toEqual(["DN-00088"]);
  });

  it("returns everything that matches, not just five", () => {
    // A search is not a preview. "DN-0009" is the three in the nineties, and
    // "DN-000" is all seven — more than the five the empty box offers, which is
    // the point: the default is a shortlist, a search is not.
    expect(matchTrips(TRIPS, "DN-0009").map((t) => t.billNo)).toEqual([
      "DN-00092",
      "DN-00091",
      "DN-00090",
    ]);
    expect(matchTrips(TRIPS, "DN-000")).toHaveLength(7);
  });

  it("says nothing matched rather than falling back to the recent five", () => {
    // A search that quietly showed the default list would have the merchant
    // pick the wrong trip believing it was the one they searched for.
    expect(matchTrips(TRIPS, "DN-99999")).toEqual([]);
  });

  it("ignores stray spaces around what was typed", () => {
    expect(matchTrips(TRIPS, "  88  ").map((t) => t.billNo)).toEqual(["DN-00088"]);
  });
});
