import "server-only";
import { Prisma } from "@/generated/prisma/client";
import type { TripChannel, TripStatus } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";

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
  /** Rent still to settle: rentAmount − advance − rent carried on a bill. */
  rentUnsettled: Prisma.Decimal;
};

export function tallyTrip(trip: {
  channel: TripChannel;
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

  const rentCarried = trip.sales.reduce(
    (a, s) => a.add(s.rentDeducted ?? ZERO),
    ZERO
  );
  const rentUnsettled = (trip.rentAmount ?? ZERO)
    .sub(trip.advancePaid ?? ZERO)
    .sub(rentCarried);

  return {
    boxesDispatched,
    boxesBilled,
    kgDispatched,
    kgBilled,
    kgGap,
    gapValue,
    billCount: trip.sales.length,
    billedAmount,
    rentUnsettled,
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
export function deriveTripStatus(
  channel: TripChannel,
  tally: TripTally
): TripStatus {
  if (tally.billCount === 0) return "DISPATCHED";

  if (channel === "MARKET") {
    // Billed boxes can exceed dispatched when a market splits a box; the trip
    // is still fully accounted for, so this is >= rather than ===.
    if (tally.boxesDispatched > 0 && tally.boxesBilled >= tally.boxesDispatched)
      return "CLOSED";
    return "PART_BILLED";
  }

  return "CLOSED";
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

  const next = deriveTripStatus(trip.channel, tallyTrip(trip));
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
 * Trips a bill of this channel may still be attached to.
 *
 * CLOSED trips are excluded, with one exception: the trip a bill being edited
 * already points at. Closing is derived from the boxes billed, so the very act
 * of billing the last box closes the trip — and refusing to re-open that bill
 * for correction would be the wrong lesson to draw from it.
 */
export async function openTripsForChannel(
  scope: { companyId: string; centreId: string },
  channel: TripChannel,
  includeTripId?: string | null
) {
  const trips = await prisma.deliveryNote.findMany({
    where: {
      ...scope,
      channel,
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
      vehicle: { select: { number: true } },
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

  return trips.map((t) => {
    const tally = tallyTrip({ ...t, channel });
    return {
      id: t.id,
      billNo: t.billNo,
      date: t.date.toISOString().slice(0, 10),
      vehicleNumber: t.vehicle.number,
      boxesDispatched: tally.boxesDispatched,
      rentUnsettled: tally.rentUnsettled.toNumber(),
    };
  });
}
