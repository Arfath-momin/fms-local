import "server-only";
import { Prisma } from "@/generated/prisma/client";
import type { TripChannel, TripStatus } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import type { PackType } from "@/generated/prisma/enums";

export const TRIP_CHANNEL_LABELS: Record<TripChannel, string> = {
  MARKET: "Market",
  FACTORY: "Factory",
  FISH_MILL: "Fish Mill",
  LOCAL: "Local",
};

export const TRIP_STATUS_LABELS: Record<TripStatus, string> = {
  DISPATCHED: "Dispatched",
  PART_BILLED: "Part billed",
  CLOSED: "Closed",
};

const ZERO = new Prisma.Decimal(0);

/**
 * What went out on a trip, and what has been billed back against it.
 *
 * The two tallies answer different questions per channel, which is why they are
 * computed together rather than as two screens:
 *
 *   MARKET   boxes dispatched vs boxes billed. A truck visits several markets,
 *            so the bills arrive piecemeal and the boxes have to add up.
 *   FACTORY  kilos dispatched vs kilos ACCEPTED. Factories reweigh on arrival
 *            and pay for less than was sent; the gap is the rejection, and it
 *            has to be visible and valued rather than quietly absorbed.
 */
export type TripTally = {
  boxesDispatched: number;
  boxesBilled: number;
  kgDispatched: Prisma.Decimal;
  kgBilled: Prisma.Decimal;
  /** kgDispatched − kgBilled. Positive means the factory rejected weight. */
  kgGap: Prisma.Decimal;
  /** kgGap valued at the average rate actually billed. Zero when nothing is. */
  gapValue: Prisma.Decimal;
  billCount: number;
  billedAmount: Prisma.Decimal;
};

export function tallyTrip(trip: {
  rentAmount: Prisma.Decimal | null;
  advancePaid: Prisma.Decimal | null;
  lines: { kg: Prisma.Decimal; box: number }[];
  sales: {
    amount: Prisma.Decimal;
    rentDeducted: Prisma.Decimal | null;
    lines: { qtyKg: Prisma.Decimal; box: number | null }[];
  }[];
}): TripTally {
  const boxesDispatched = trip.lines.reduce((a, l) => a + l.box, 0);
  const kgDispatched = trip.lines.reduce((a, l) => a.add(l.kg), ZERO);

  const boxesBilled = trip.sales.reduce(
    (a, s) => a + s.lines.reduce((b, l) => b + (l.box ?? 0), 0),
    0
  );
  // A fish-mill line's kgs is the weight of ONE box, so the row's real weight
  // is box × kgs — the same rule saleLineTotalKg applies. A line with no boxes
  // counts once.
  const kgBilled = trip.sales.reduce(
    (a, s) =>
      a.add(
        s.lines.reduce(
          (b, l) => b.add(l.box && l.box > 0 ? l.qtyKg.mul(l.box) : l.qtyKg),
          ZERO
        )
      ),
    ZERO
  );

  const billedAmount = trip.sales.reduce((a, s) => a.add(s.amount), ZERO);
  const kgGap = kgDispatched.sub(kgBilled);

  // Valued at what the trip actually fetched per kilo, not at a rate nobody
  // agreed: a rejection is worth what the accepted fish sold for.
  const gapValue = kgBilled.gt(0)
    ? kgGap.mul(billedAmount).div(kgBilled).toDecimalPlaces(2)
    : ZERO;

  return {
    boxesDispatched,
    boxesBilled,
    kgDispatched,
    kgBilled,
    kgGap,
    gapValue,
    billCount: trip.sales.length,
    billedAmount,
  };
}

/**
 * Where a trip stands, from its own tally.
 *
 * Deliberately DERIVED rather than set by hand. A status somebody has to
 * remember to change is a status that goes stale, and the whole value of the
 * open-trips worklist is that it is trustworthy without anybody maintaining it.
 * The stored column is kept in step by recomputing it whenever a bill lands.
 *
 * A market trip closes when every box is accounted for; a factory or mill trip
 * closes on its first bill, because the whole load goes to one buyer and the
 * rejection gap is a fact about that bill, not an outstanding delivery.
 */
export function deriveTripStatus(tally: TripTally): TripStatus {
  if (tally.billCount === 0) return "DISPATCHED";

  // Boxes, for every trip, whatever it went out as. A non-market trip used to
  // CLOSE on its first bill, on the assumption that the whole load went to one
  // buyer — which is why a factory trip vanished from the picker the moment its
  // factory bill landed, and the returns sold on the way home had no trip left
  // to belong to. One journey, several bills, and it is only finished when the
  // boxes are.
  //
  // A note that recorded no boxes at all — weight only — has nothing to tally,
  // so the first bill closes it. Holding such a trip open forever would fill
  // the picker with journeys nobody can ever finish.
  if (tally.boxesDispatched === 0) return "CLOSED";

  // Billed can exceed dispatched when a buyer splits a box, so this is >=
  // rather than ===.
  if (tally.boxesBilled >= tally.boxesDispatched) return "CLOSED";
  return "PART_BILLED";
}

/**
 * Recompute and store a trip's status after a bill lands, changes or is removed.
 *
 * Called from inside the sale action's transaction, so the status a list shows
 * is never a step behind the bills it was derived from.
 */
export async function refreshTripStatus(
  tx: Prisma.TransactionClient,
  deliveryNoteId: string | null
): Promise<void> {
  if (!deliveryNoteId) return;

  const trip = await tx.deliveryNote.findUnique({
    where: { id: deliveryNoteId },
    select: {
      channel: true,
      rentAmount: true,
      advancePaid: true,
      status: true,
      lines: { select: { kg: true, box: true } },
      sales: {
        select: {
          amount: true,
          rentDeducted: true,
          lines: { select: { qtyKg: true, box: true } },
        },
      },
    },
  });
  if (!trip) return;

  const next = deriveTripStatus(tallyTrip(trip));
  // Only write when it actually moved — an unchanged status is not an edit,
  // and updatedAt on the trip should mean somebody changed the trip.
  if (next !== trip.status) {
    await tx.deliveryNote.update({
      where: { id: deliveryNoteId },
      data: { status: next },
    });
  }
}

/**
 * Trips a bill may still be attached to — any bill, of any kind.
 *
 * This used to filter by channel, so a market bill was offered only market
 * trips and a LOCAL bill was offered none at all. That does not survive contact
 * with the business: a truck goes out to the factory, the factory rejects part
 * of the load, and the returns are sold at a market or locally on the way home.
 * One journey, one rent, several bills — and the channel filter made every bill
 * after the first one impossible to attach, which is exactly the trip whose
 * boxes most needed accounting for.
 *
 * CLOSED trips are excluded, with one exception: the trip a bill being edited
 * already points at. Closing is derived from the boxes billed, so the very act
 * of billing the last box closes the trip — and refusing to re-open that bill
 * for correction would be the wrong lesson to draw from it.
 */
export async function openTrips(
  scope: { companyId: string; centreId: string },
  includeTripId?: string | null,
  /** The bill being edited — its own boxes count as still available. */
  excludeSaleId?: string | null
) {
  const trips = await prisma.deliveryNote.findMany({
    where: {
      ...scope,
      ...(includeTripId
        ? { OR: [{ status: { not: "CLOSED" } }, { id: includeTripId }] }
        : { status: { not: "CLOSED" } }),
    },
    orderBy: [{ date: "desc" }, { billNo: "asc" }],
    // Bounded: a merchant does not have hundreds of trips open, and a runaway
    // list here would mean something is wrong with the closing rule.
    take: 100,
    select: {
      id: true,
      billNo: true,
      date: true,
      rentAmount: true,
      advancePaid: true,
      vehicle: {
        select: { number: true, transporter: { select: { name: true } } },
      },
      lines: { select: { pack: true, particulars: true, kg: true, box: true } },
      sales: {
        select: {
          id: true,
          amount: true,
          rentDeducted: true,
          lines: { select: { pack: true, particular: true, qtyKg: true, box: true } },
        },
      },
    },
  });

  return trips.map((t) => {
    const tally = tallyTrip(t);
    return {
      id: t.id,
      billNo: t.billNo,
      date: t.date.toISOString().slice(0, 10),
      vehicleNumber: t.vehicle.number,
      // Who the rent is owed to. Carried so a bill's expense panel can name
      // the transporter without the clerk typing — and without two spellings
      // splitting one man's account in two.
      transporterName: t.vehicle.transporter.name,
      boxesDispatched: tally.boxesDispatched,
      advancePaid: (t.advancePaid ?? ZERO).toNumber(),
      // What is left to bill, by particular. This is what a market bill starts
      // from: the trip went out with 100 bangdha and 50 prawns, an earlier
      // market took 40 bangdha, and this one is offered the remaining 60 and
      // 50. Pre-filling the FULL load instead would let three bills quietly
      // add up to more than ever went out.
      remaining: remainingByParticular(t, excludeSaleId),
    };
  });
}

/**
 * Boxes and weight still unbilled on a trip, per particular.
 *
 * `excludeSaleId` leaves out the bill being edited, so re-opening a bill offers
 * back the boxes it already claimed rather than showing them as taken.
 */
function remainingByParticular(
  trip: {
    lines: {
      pack: PackType;
      particulars: string;
      kg: Prisma.Decimal;
      box: number;
    }[];
    sales: {
      id: string;
      lines: {
        pack: PackType;
        particular: string;
        qtyKg: Prisma.Decimal;
        box: number | null;
      }[];
    }[];
  },
  excludeSaleId?: string | null
) {
  const out = new Map<
    string,
    { pack: PackType; particular: string; box: number; kg: Prisma.Decimal }
  >();
  for (const l of trip.lines) {
    // Keyed by particular AND pack. The same fish sent loose and in boxes on
    // one note is two things to account for, and merging them would put crates
    // against a consignment that never had any.
    const key = `${l.particulars.trim().toLowerCase()}|${l.pack}`;
    const hit = out.get(key);
    if (hit) {
      hit.box += l.box;
      hit.kg = hit.kg.add(l.kg);
    } else {
      out.set(key, {
        pack: l.pack,
        particular: l.particulars,
        box: l.box,
        kg: l.kg,
      });
    }
  }

  for (const sale of trip.sales) {
    if (excludeSaleId && sale.id === excludeSaleId) continue;
    for (const l of sale.lines) {
      const key = `${l.particular.trim().toLowerCase()}|${l.pack}`;
      const hit = out.get(key);
      if (!hit) continue;
      hit.box -= l.box ?? 0;
      hit.kg = hit.kg.sub(l.qtyKg);
    }
  }

  return [...out.values()]
    // A particular already fully billed drops off rather than showing zero.
    .filter((r) => r.box > 0 || r.kg.gt(0))
    .map((r) => ({
      pack: r.pack,
      particular: r.particular,
      box: Math.max(0, r.box),
      kg: r.kg.gt(0) ? r.kg.toNumber() : 0,
    }));
}

/**
 * One trip's boxes, from the truck to each party that unloaded them.
 *
 * The record a merchant actually keeps in his head: a hundred boxes went out,
 * this market took forty, that one thirty, the last thirty — and it has to come
 * back to nothing. The reconciliation panel on a trip answers "does it add up";
 * this answers "where did they go", which is the question when a market claims
 * it received less than it was billed for.
 *
 * Broken down by particular as well as by party, because a truck carries two or
 * three varieties and "sixty boxes" is not an answer when forty were bangdha.
 */

/**
 * The trips a cost can be entered against, newest first.
 *
 * Every trip, not just the open ones: a bill or a line man's payment often
 * turns up days after the load was closed, and offering only open trips would
 * leave the clerk with nowhere to file a cost that plainly belongs to one.
 *
 * Shared because both the new-expense screen and the edit screen need the same
 * list. The edit screen having no list at all was a quiet data-loss bug: the
 * picker never rendered, so saving an edit submitted no trip and cleared the
 * link the voucher already had.
 */
export type TripOption = {
  id: string;
  billNo: string;
  /** yyyy-mm-dd, ready for a date input. */
  date: string;
  vehicleNumber: string;
  transporterName: string;
  advancePaid: number;
};

export async function tripOptions(scope: {
  companyId: string;
  centreId: string;
}): Promise<TripOption[]> {
  const trips = await prisma.deliveryNote.findMany({
    where: scope,
    orderBy: [{ date: "desc" }, { billNo: "desc" }],
    take: 60,
    select: {
      id: true,
      billNo: true,
      date: true,
      advancePaid: true,
      vehicle: {
        select: { number: true, transporter: { select: { name: true } } },
      },
    },
  });
  return trips.map((t) => ({
    id: t.id,
    billNo: t.billNo,
    date: t.date.toISOString().slice(0, 10),
    vehicleNumber: t.vehicle.number,
    transporterName: t.vehicle.transporter.name,
    advancePaid: Number(t.advancePaid ?? 0),
  }));
}

export type BoxStatementDrop = {
  saleId: string;
  billNo: string;
  partyName: string;
  boxes: number;
  /** Which varieties made up that drop. */
  byParticular: { particular: string; boxes: number }[];
};

export type BoxStatement = {
  tripId: string;
  billNo: string;
  date: Date;
  status: TripStatus;
  vehicleNumber: string;
  dispatched: number;
  dispatchedByParticular: { particular: string; boxes: number }[];
  drops: BoxStatementDrop[];
  /** dispatched − everything dropped. Zero when the load is accounted for. */
  unaccounted: number;
  /**
   * True when the bills off this trip do not count boxes at all.
   *
   * A factory reweighs the load and bills the KILOS it accepted; a lump-sum
   * bill itemises nothing. Either way the box column is empty, and calling
   * that "100 unaccounted" would report a discrepancy where none exists — the
   * boxes simply are not how that trip was billed. The kilo gap is the tally
   * that matters there, and the trip's own reconciliation panel shows it.
   */
  billedWithoutBoxes: boolean;
  cratesReturned: number | null;
};

function tallyBoxes(
  rows: { particular: string; box: number | null }[]
): { total: number; byParticular: { particular: string; boxes: number }[] } {
  const by = new Map<string, { particular: string; boxes: number }>();
  let total = 0;
  for (const r of rows) {
    const boxes = r.box ?? 0;
    if (boxes === 0) continue;
    total += boxes;
    const key = r.particular.trim().toLowerCase();
    const hit = by.get(key);
    if (hit) hit.boxes += boxes;
    else by.set(key, { particular: r.particular, boxes });
  }
  return {
    total,
    byParticular: [...by.values()].sort((a, b) => b.boxes - a.boxes),
  };
}

export async function boxStatements(
  scope: { companyId: string; centreId: string },
  window: { from: Date; to: Date }
): Promise<BoxStatement[]> {
  const trips = await prisma.deliveryNote.findMany({
    where: { ...scope, date: { gte: window.from, lte: window.to } },
    orderBy: [{ date: "desc" }, { billNo: "desc" }],
    select: {
      id: true,
      billNo: true,
      date: true,
      status: true,
      cratesReturned: true,
      vehicle: { select: { number: true } },
      lines: { select: { particulars: true, box: true } },
      sales: {
        orderBy: [{ date: "asc" }, { billNo: "asc" }],
        select: {
          id: true,
          billNo: true,
          party: { select: { name: true } },
          careOfParty: { select: { name: true } },
          lines: { select: { particular: true, box: true } },
        },
      },
    },
  });

  return trips.map((t) => {
    const out = tallyBoxes(
      t.lines.map((l) => ({ particular: l.particulars, box: l.box }))
    );

    const drops = t.sales.map((sale) => {
      const got = tallyBoxes(sale.lines);
      return {
        saleId: sale.id,
        billNo: sale.billNo,
        // The CareOf agent is who the money goes through, but the boxes went
        // to the buyer — this column is about where the fish physically went.
        partyName: sale.party.name,
        boxes: got.total,
        byParticular: got.byParticular,
      };
    });

    return {
      tripId: t.id,
      billNo: t.billNo,
      date: t.date,
      status: t.status,
      vehicleNumber: t.vehicle.number,
      dispatched: out.total,
      dispatchedByParticular: out.byParticular,
      drops,
      unaccounted: out.total - drops.reduce((a, d) => a + d.boxes, 0),
      billedWithoutBoxes:
        drops.length > 0 && drops.every((d) => d.boxes === 0),
      cratesReturned: t.cratesReturned,
    };
  });
}
